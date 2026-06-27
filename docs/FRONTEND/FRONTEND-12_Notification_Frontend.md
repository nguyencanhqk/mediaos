# FRONTEND-12: NOTIFICATION FRONTEND

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · **FRONTEND-12 Notification** · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Đặc tả: SPEC-08 NOTI](<../SPEC/SPEC-08 NOTI.md>) · [NOTI API: API-07](<../API Design/API-07_NOTI_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-12 |
| Tên tài liệu | Notification Frontend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | NOTI - Thông báo hệ thống |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-11 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-12 mô tả cách triển khai frontend cho module **NOTI - Thông báo hệ thống** trong MVP.

Tài liệu này dùng để:

1. Chốt cấu trúc route, screen, component và hook cho notification frontend.
2. Triển khai notification badge trên Topbar.
3. Triển khai notification dropdown dùng trong toàn bộ protected layout.
4. Triển khai trang danh sách thông báo của người dùng hiện tại.
5. Triển khai màn chi tiết thông báo và deep link sang module nghiệp vụ gốc.
6. Triển khai action: mark read, mark unread nếu bật, mark all read, hide, archive và delete soft.
7. Triển khai màn quản trị notification event, template, channel, delivery log và system notification nếu người dùng có quyền.
8. Chuẩn hóa query key, mutation, optimistic update và invalidation cho unread count/dropdown/list.
9. Đảm bảo mọi dữ liệu notification hiển thị theo permission, data scope và owner hiện tại.
10. Làm checklist cho frontend, backend và QA khi nghiệm thu module NOTI.

---

## 3. Vị trí FRONTEND-12 trong roadmap frontend

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

FRONTEND-12 không triển khai backend event pipeline. Frontend chỉ tiêu thụ API NOTI public/admin và hiển thị đúng trạng thái.

---

## 4. Căn cứ triển khai

FRONTEND-12 bám theo các quyết định đã chốt:

1. NOTI là module dùng chung cho toàn hệ thống.
2. Topbar cần hiển thị unread badge nếu user có quyền xem notification cá nhân.
3. Dropdown chỉ hiển thị notification mới nhất, không thay thế trang danh sách đầy đủ.
4. Notification list là workspace riêng trong ModuleWorkspaceLayout.
5. Notification detail có thể mark read và điều hướng sang target route.
6. Deep link không được bỏ qua route guard, permission guard, data scope và business rule của module gốc.
7. Frontend không được tự tin rằng notification target luôn mở được; target có thể bị xóa, đổi trạng thái hoặc user mất quyền.
8. API client, query layer, error mapper và response contract dùng theo FRONTEND-04.
9. Permission và data scope dùng theo FRONTEND-03, không hard-code theo role name.
10. UI dùng Design System ở FRONTEND-02/UI-05: `NotificationBadge`, `NotificationDropdown`, `NotificationListItem`, `DataTable`, `Drawer`, `Modal`, `Toast`, `EmptyState`, `ErrorState`, `ForbiddenState`, `Skeleton`, `PermissionGate`.
11. Admin notification config chỉ hiển thị khi có permission tương ứng.
12. Realtime WebSocket/mobile push/email nâng cao để phase sau; MVP ưu tiên IN_APP + polling nhẹ hoặc manual refresh.

---

## 5. Phạm vi FRONTEND-12

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung |
| --- | --- |
| Topbar notification | Badge unread count, dropdown trigger, loading/error state nhẹ |
| Notification dropdown | Latest notifications, unread dot, mark all read, view all, item deep link |
| My notification list | Danh sách thông báo của tôi, filter, search, pagination, actions |
| Notification detail | Xem nội dung, mark read, target CTA, metadata, unavailable state |
| Notification actions | Mark read, mark unread nếu bật, mark all read, hide, archive, delete soft |
| Admin event config | Danh sách event, bật/tắt event nếu có quyền |
| Admin template config | Danh sách template, tạo/sửa/xóa mềm, preview render |
| Channel config | Xem/cập nhật kênh gửi, MVP ưu tiên IN_APP |
| Delivery logs | Xem log gửi, filter, retry nếu có quyền |
| System notification | Tạo/gửi thông báo hệ thống thủ công nếu có quyền |
| Query/invalidation | Query key, optimistic update, invalidation unread/dropdown/list/detail |
| Permission UI | Ẩn/disable route, menu, tab, action theo permission/data scope |
| Responsive | Desktop/tablet/mobile web cho dropdown, list, detail |
| Test & QA | Unit, integration, E2E, permission, deep link, state, responsive |

### 5.2 Không bao gồm trong MVP

| Nội dung | Giai đoạn đề xuất |
| --- | --- |
| WebSocket realtime production gateway | Phase sau |
| Mobile push device token | Phase mobile |
| Email provider advanced delivery | Phase sau |
| Quiet hours / Do Not Disturb cá nhân | Phase sau |
| Notification digest ngày/tuần | Phase sau |
| Notification grouping/threading nâng cao | Phase sau |
| Analytics tỷ lệ đọc/click | Phase sau |
| Slack/Teams integration | Phase sau |
| AI summary notification | Phase 5 |

---

## 6. Nguyên tắc trải nghiệm NOTI

### 6.1 Notification là lớp điều hướng, không phải lớp phân quyền cuối cùng

Khi user click notification:

```text
Click notification
-> Mark read nếu cần
-> Resolve target route
-> Navigate sang module gốc
-> Route guard kiểm tra route permission
-> API module gốc kiểm tra permission + data scope + business rule
-> Nếu không hợp lệ: hiển thị Forbidden/TargetUnavailable
```

Frontend không được mở trực tiếp detail nghiệp vụ chỉ vì notification có `target_url`.

### 6.2 Không làm lộ dữ liệu nhạy cảm

Notification item chỉ hiển thị dữ liệu đủ để user hiểu ngữ cảnh:

1. Title.
2. Short content.
3. Source module.
4. Priority/type.
5. Time.
6. Target CTA.

Không hiển thị payload nhạy cảm như lương, số giấy tờ, dữ liệu cá nhân nhạy cảm hoặc file private trong dropdown/list.

### 6.3 Badge phải nhẹ và ổn định

Unread count được gọi thường xuyên ở topbar nên frontend cần:

1. Dùng query riêng `useUnreadCountQuery`.
2. `staleTime` ngắn vừa phải.
3. Không refetch liên tục khi tab inactive.
4. Refetch khi focus window nếu cần.
5. Invalidate sau mark read/mark all read/hide/archive/delete.
6. Không block toàn bộ layout nếu unread count lỗi.

### 6.4 Dropdown không thay thế list page

Dropdown chỉ dùng để xem nhanh 5-7 thông báo mới nhất. Các thao tác lọc, search, phân trang, archive, delete nên xử lý tại `/notifications`.

### 6.5 Action phải có phản hồi tức thì

| Action | UI feedback |
| --- | --- |
| Mark read | Item chuyển read, dot biến mất, badge giảm |
| Mark all read | Badge về 0 hoặc giảm theo response, list cập nhật |
| Hide/archive/delete | Item biến mất khỏi danh sách hiện tại, toast success |
| Open target | Button loading ngắn, sau đó navigate |
| Retry delivery log | Confirm nếu cần, toast kết quả |
| Save template/event/channel | Dirty state, confirm nếu thay đổi quan trọng, toast success |

---

## 7. Route structure

### 7.1 Public/protected route

Mọi route NOTI là protected route.

```text
src/app/(protected)/notifications/
  page.tsx
  [notificationId]/page.tsx
  unread/page.tsx
  archived/page.tsx
  events/page.tsx
  events/[eventId]/page.tsx
  templates/page.tsx
  templates/new/page.tsx
  templates/[templateId]/page.tsx
  delivery-logs/page.tsx
  delivery-logs/[logId]/page.tsx
  channels/page.tsx
  system/new/page.tsx
  settings/page.tsx
```

### 7.2 Route MVP bắt buộc

| Route | Màn hình | Priority | Permission |
| --- | --- | --- | --- |
| `/notifications` | Danh sách thông báo của tôi | P0 | `NOTI.NOTIFICATION.VIEW_OWN` |
| `/notifications/:notificationId` | Chi tiết thông báo | P1 | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |
| `/notifications/events` | Notification events | P2 | `NOTI.EVENT.VIEW` |
| `/notifications/templates` | Notification templates | P2 | `NOTI.TEMPLATE.VIEW` |
| `/notifications/delivery-logs` | Delivery logs | P2 | `NOTI.LOG.VIEW` |
| `/notifications/channels` | Channel config | P2 | `NOTI.CHANNEL.VIEW` |
| `/notifications/system/new` | Gửi thông báo hệ thống | P2 | `NOTI.NOTIFICATION.CREATE_SYSTEM` |
| `/notifications/settings` | Notification settings | P2 | `NOTI.CHANNEL.VIEW` hoặc `NOTI.EVENT.VIEW` |

### 7.3 Route metadata

```ts
export const notificationRoutes = [
  {
    key: 'notification.my.list',
    path: '/notifications',
    moduleCode: 'NOTI',
    screenCode: 'UI-NOTI-SCREEN-002',
    layout: 'ModuleWorkspaceLayout',
    requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_OWN'],
    dataScopes: ['Own'],
    title: 'Thông báo của tôi',
    breadcrumb: ['Thông báo', 'Tất cả thông báo'],
  },
  {
    key: 'notification.my.detail',
    path: '/notifications/:notificationId',
    moduleCode: 'NOTI',
    screenCode: 'UI-NOTI-SCREEN-003',
    layout: 'ModuleWorkspaceLayout',
    requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_DETAIL_OWN'],
    dataScopes: ['Own'],
    title: 'Chi tiết thông báo',
  },
  {
    key: 'notification.event.list',
    path: '/notifications/events',
    moduleCode: 'NOTI',
    screenCode: 'UI-NOTI-SCREEN-004',
    layout: 'ModuleWorkspaceLayout',
    requiredAnyPermissions: ['NOTI.EVENT.VIEW'],
    dataScopes: ['Company', 'System'],
    title: 'Notification events',
  },
] as const;
```

---

## 8. Sidebar NOTI

### 8.1 Sidebar đề xuất

```text
Thông báo của tôi
- Tất cả thông báo
- Chưa đọc
- Đã lưu trữ

Quản trị thông báo
- Notification events
- Templates
- Delivery logs
- System notification

Thiết lập
- Kênh gửi
- Notification settings
```

### 8.2 Sidebar config

```ts
export const notificationSidebar = [
  {
    group: 'Thông báo của tôi',
    items: [
      {
        key: 'notification.my.all',
        label: 'Tất cả thông báo',
        path: '/notifications',
        icon: 'bell',
        requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_OWN'],
        badgeQueryKey: ['notifications', 'unread-count'],
      },
      {
        key: 'notification.my.unread',
        label: 'Chưa đọc',
        path: '/notifications?status=Unread',
        icon: 'mail-unread',
        requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_OWN'],
      },
      {
        key: 'notification.my.archived',
        label: 'Đã lưu trữ',
        path: '/notifications?status=Archived',
        icon: 'archive',
        requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_OWN'],
      },
    ],
  },
  {
    group: 'Quản trị thông báo',
    requiredAnyPermissions: [
      'NOTI.EVENT.VIEW',
      'NOTI.TEMPLATE.VIEW',
      'NOTI.LOG.VIEW',
      'NOTI.NOTIFICATION.CREATE_SYSTEM',
    ],
    items: [
      {
        key: 'notification.events',
        label: 'Notification events',
        path: '/notifications/events',
        icon: 'workflow',
        requiredAnyPermissions: ['NOTI.EVENT.VIEW'],
      },
      {
        key: 'notification.templates',
        label: 'Templates',
        path: '/notifications/templates',
        icon: 'file-text',
        requiredAnyPermissions: ['NOTI.TEMPLATE.VIEW'],
      },
      {
        key: 'notification.deliveryLogs',
        label: 'Delivery logs',
        path: '/notifications/delivery-logs',
        icon: 'activity',
        requiredAnyPermissions: ['NOTI.LOG.VIEW'],
      },
      {
        key: 'notification.systemNew',
        label: 'System notification',
        path: '/notifications/system/new',
        icon: 'megaphone',
        requiredAnyPermissions: ['NOTI.NOTIFICATION.CREATE_SYSTEM'],
      },
    ],
  },
  {
    group: 'Thiết lập',
    requiredAnyPermissions: ['NOTI.CHANNEL.VIEW'],
    items: [
      {
        key: 'notification.channels',
        label: 'Kênh gửi',
        path: '/notifications/channels',
        icon: 'radio',
        requiredAnyPermissions: ['NOTI.CHANNEL.VIEW'],
      },
    ],
  },
] as const;
```

---

## 9. Folder structure đề xuất

```text
src/features/notifications/
  api/
    notification.api.ts
    notification.keys.ts
    notification.mappers.ts
  components/
    NotificationBadge.tsx
    NotificationBellButton.tsx
    NotificationDropdown.tsx
    NotificationDropdownItem.tsx
    NotificationList.tsx
    NotificationListItem.tsx
    NotificationFilterBar.tsx
    NotificationDetailPanel.tsx
    NotificationTargetButton.tsx
    NotificationPriorityBadge.tsx
    NotificationStatusBadge.tsx
    NotificationModuleBadge.tsx
    NotificationEmptyState.tsx
    NotificationTargetUnavailable.tsx
    NotificationTemplateEditor.tsx
    NotificationTemplatePreview.tsx
    NotificationEventStatusSwitch.tsx
    NotificationDeliveryLogTable.tsx
    SystemNotificationForm.tsx
  hooks/
    useUnreadCountQuery.ts
    useNotificationDropdownQuery.ts
    useNotificationsQuery.ts
    useNotificationDetailQuery.ts
    useMarkNotificationReadMutation.ts
    useMarkAllNotificationsReadMutation.ts
    useHideNotificationMutation.ts
    useArchiveNotificationMutation.ts
    useDeleteNotificationMutation.ts
    useOpenNotificationTargetMutation.ts
    useNotificationEventsQuery.ts
    useNotificationTemplatesQuery.ts
    useNotificationDeliveryLogsQuery.ts
    useNotificationChannelsQuery.ts
  pages/
    MyNotificationListPage.tsx
    NotificationDetailPage.tsx
    NotificationEventsPage.tsx
    NotificationTemplatesPage.tsx
    NotificationTemplateDetailPage.tsx
    NotificationDeliveryLogsPage.tsx
    NotificationChannelsPage.tsx
    SystemNotificationPage.tsx
  schemas/
    notification.schemas.ts
    notification-template.schema.ts
    system-notification.schema.ts
  types/
    notification.types.ts
  utils/
    notification-target.ts
    notification-display.ts
    notification-permission.ts
  mocks/
    notification.handlers.ts
    notification.fixtures.ts
  tests/
    notification.api.test.ts
    notification.hooks.test.ts
    notification-target.test.ts
```

---

## 10. TypeScript domain types

### 10.1 Enum types

```ts
export type NotificationType =
  | 'System'
  | 'Account'
  | 'HR'
  | 'Attendance'
  | 'Leave'
  | 'Task'
  | 'Project'
  | 'Approval'
  | 'Reminder'
  | 'Warning'
  | 'Error';

export type NotificationPriority = 'Low' | 'Normal' | 'High' | 'Urgent' | 'Critical';

export type NotificationStatus = 'Unread' | 'Read' | 'Hidden' | 'Archived' | 'Deleted';

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH' | 'REALTIME' | 'INTEGRATION';

export type DeliveryStatus = 'Pending' | 'Sent' | 'Delivered' | 'Failed' | 'Skipped' | 'Cancelled';
```

### 10.2 Notification DTO

```ts
export interface NotificationSummaryDto {
  notification_id: string;
  title: string;
  short_content: string;
  notification_type: NotificationType;
  priority: NotificationPriority;
  status: NotificationStatus;
  is_read: boolean;
  source_module: string;
  event_code: string;
  target_module?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  target_url?: string | null;
  created_at: string;
  read_at?: string | null;
}

export interface NotificationTargetDto {
  target_module: string;
  target_type: string;
  target_id: string;
  target_url: string;
  can_open?: boolean;
  unavailable_reason?: string | null;
}

export interface NotificationDetailDto extends NotificationSummaryDto {
  content: string;
  source_entity_type?: string | null;
  source_entity_id?: string | null;
  target?: NotificationTargetDto | null;
  payload?: Record<string, unknown> | null;
  expires_at?: string | null;
}

export interface UnreadCountDto {
  unread_count: number;
  high_priority_unread_count: number;
  urgent_unread_count: number;
  last_notification_at?: string | null;
}
```

### 10.3 List params

```ts
export interface NotificationListParams {
  page?: number;
  per_page?: number;
  search?: string;
  status?: NotificationStatus;
  notification_type?: NotificationType;
  source_module?: string;
  event_code?: string;
  priority?: NotificationPriority;
  target_module?: string;
  created_from?: string;
  created_to?: string;
  read?: boolean;
  include_hidden?: boolean;
  include_archived?: boolean;
  sort?: string;
}

export interface NotificationDropdownParams {
  limit?: number;
  only_unread?: boolean;
}
```

### 10.4 Admin DTO rút gọn

```ts
export interface NotificationEventDto {
  event_id: string;
  event_code: string;
  module_code: string;
  name: string;
  description?: string | null;
  default_type: NotificationType;
  default_priority: NotificationPriority;
  enabled: boolean;
  dedupe_enabled: boolean;
  dedupe_window_seconds?: number | null;
  recipient_resolver: string;
  company_override: boolean;
  updated_at: string;
}

export interface NotificationTemplateDto {
  template_id: string;
  template_code: string;
  event_code: string;
  channel: NotificationChannel;
  locale: string;
  title_template: string;
  short_template: string;
  content_template: string;
  variables_schema?: Record<string, unknown> | null;
  status: 'Active' | 'Inactive' | 'Draft' | 'Deprecated';
  is_default: boolean;
  updated_at: string;
}

export interface NotificationDeliveryLogDto {
  delivery_log_id: string;
  notification_id?: string | null;
  recipient_user_id?: string | null;
  channel: NotificationChannel;
  provider: string;
  delivery_status: DeliveryStatus;
  attempt_no: number;
  max_attempts: number;
  error_code?: string | null;
  error_message?: string | null;
  scheduled_at?: string | null;
  sent_at?: string | null;
  next_retry_at?: string | null;
  created_at: string;
}
```

---

## 11. API service implementation

### 11.1 notification.api.ts

```ts
import { apiClient } from '@/shared/api/api-client';
import type { ApiSuccessResponse, PaginatedResponse } from '@/shared/api/types';
import type {
  NotificationDetailDto,
  NotificationDropdownParams,
  NotificationListParams,
  NotificationSummaryDto,
  UnreadCountDto,
  NotificationEventDto,
  NotificationTemplateDto,
  NotificationDeliveryLogDto,
} from '../types/notification.types';

export const notificationApi = {
  getUnreadCount() {
    return apiClient.get<UnreadCountDto>('/notifications/unread-count');
  },

  getDropdown(params?: NotificationDropdownParams) {
    return apiClient.get<NotificationSummaryDto[]>('/notifications/dropdown', {
      query: params,
    });
  },

  getMyNotifications(params: NotificationListParams) {
    return apiClient.get<NotificationSummaryDto[]>('/notifications', {
      query: params,
    });
  },

  getNotificationDetail(notificationId: string) {
    return apiClient.get<NotificationDetailDto>(`/notifications/${notificationId}`);
  },

  markRead(notificationId: string) {
    return apiClient.post<NotificationDetailDto | NotificationSummaryDto>(
      `/notifications/${notificationId}/mark-read`,
    );
  },

  markUnread(notificationId: string) {
    return apiClient.post<NotificationDetailDto | NotificationSummaryDto>(
      `/notifications/${notificationId}/mark-unread`,
    );
  },

  markAllRead() {
    return apiClient.post<{ updated_count: number }>('/notifications/mark-all-read');
  },

  hide(notificationId: string) {
    return apiClient.post<{ notification_id: string }>(`/notifications/${notificationId}/hide`);
  },

  archive(notificationId: string) {
    return apiClient.post<{ notification_id: string }>(`/notifications/${notificationId}/archive`);
  },

  deleteSoft(notificationId: string) {
    return apiClient.delete<{ notification_id: string }>(`/notifications/${notificationId}`);
  },

  openTarget(notificationId: string) {
    return apiClient.post<{ target_url: string; can_open: boolean; reason?: string | null }>(
      `/notifications/${notificationId}/open-target`,
    );
  },

  getEvents(params: { page?: number; per_page?: number; search?: string; module_code?: string }) {
    return apiClient.get<NotificationEventDto[]>('/notifications/events', { query: params });
  },

  updateEvent(eventId: string, body: Partial<Pick<NotificationEventDto, 'enabled'>>) {
    return apiClient.patch<NotificationEventDto>(`/notifications/events/${eventId}`, { body });
  },

  getTemplates(params: { page?: number; per_page?: number; search?: string; event_code?: string; channel?: string }) {
    return apiClient.get<NotificationTemplateDto[]>('/notifications/templates', { query: params });
  },

  getTemplate(templateId: string) {
    return apiClient.get<NotificationTemplateDto>(`/notifications/templates/${templateId}`);
  },

  createTemplate(body: Partial<NotificationTemplateDto>) {
    return apiClient.post<NotificationTemplateDto>('/notifications/templates', { body });
  },

  updateTemplate(templateId: string, body: Partial<NotificationTemplateDto>) {
    return apiClient.patch<NotificationTemplateDto>(`/notifications/templates/${templateId}`, { body });
  },

  deleteTemplate(templateId: string) {
    return apiClient.delete<{ template_id: string }>(`/notifications/templates/${templateId}`);
  },

  previewTemplate(templateId: string, variables: Record<string, unknown>) {
    return apiClient.post<{ title: string; short_content: string; content: string }>(
      `/notifications/templates/${templateId}/preview`,
      { body: { variables } },
    );
  },

  getDeliveryLogs(params: Record<string, unknown>) {
    return apiClient.get<NotificationDeliveryLogDto[]>('/notifications/delivery-logs', { query: params });
  },

  retryDeliveryLog(logId: string) {
    return apiClient.post<NotificationDeliveryLogDto>(`/notifications/delivery-logs/${logId}/retry`);
  },
};
```

---

## 12. Query key factory

```ts
export const notificationKeys = {
  all: ['notifications'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  dropdown: (params?: unknown) => [...notificationKeys.all, 'dropdown', params ?? {}] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
  list: (params: unknown) => [...notificationKeys.lists(), params] as const,
  detail: (notificationId: string) => [...notificationKeys.all, 'detail', notificationId] as const,
  events: (params?: unknown) => [...notificationKeys.all, 'events', params ?? {}] as const,
  templates: (params?: unknown) => [...notificationKeys.all, 'templates', params ?? {}] as const,
  template: (templateId: string) => [...notificationKeys.all, 'template', templateId] as const,
  deliveryLogs: (params?: unknown) => [...notificationKeys.all, 'delivery-logs', params ?? {}] as const,
  channels: () => [...notificationKeys.all, 'channels'] as const,
};
```

### 12.1 Cache strategy

| Query | staleTime | gcTime | Refetch |
| --- | ---: | ---: | --- |
| `unreadCount` | 30-60s | 5m | on focus nếu user active |
| `dropdown` | 15-30s | 2m | khi mở dropdown |
| `notification list` | 30-60s | 5m | manual/filter/focus |
| `notification detail` | 60s | 5m | khi vào detail |
| `events/templates/channels` | 2-5m | 10m | sau mutation config |
| `delivery logs` | 30-60s | 5m | manual/filter |

### 12.2 Invalidation matrix

| Mutation | Invalidate |
| --- | --- |
| Mark read | unread count, dropdown, list, detail |
| Mark unread | unread count, dropdown, list, detail |
| Mark all read | unread count, dropdown, all my notification lists |
| Hide/archive/delete | unread count, dropdown, list |
| Open target | unread count, dropdown, detail nếu auto mark read |
| Update event | event list/detail, template preview nếu liên quan |
| Create/update/delete template | template list/detail |
| Update channel | channel config, delivery config cache nếu có |
| Retry delivery log | delivery logs |
| Send system notification | admin notification list, delivery logs, my notification nếu current user là recipient |

---

## 13. Hook implementation skeleton

### 13.1 Unread count hook

```ts
export function useUnreadCountQuery(options?: { enabled?: boolean }) {
  const canView = usePermission('NOTI.NOTIFICATION.COUNT_UNREAD_OWN');

  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationApi.getUnreadCount(),
    enabled: (options?.enabled ?? true) && canView,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
```

### 13.2 Dropdown hook

```ts
export function useNotificationDropdownQuery(open: boolean) {
  const canView = usePermission('NOTI.NOTIFICATION.VIEW_OWN');
  const params = { limit: 7 };

  return useQuery({
    queryKey: notificationKeys.dropdown(params),
    queryFn: () => notificationApi.getDropdown(params),
    enabled: open && canView,
    staleTime: 15_000,
    gcTime: 2 * 60_000,
    retry: 1,
  });
}
```

### 13.3 My notification list hook

```ts
export function useNotificationsQuery(params: NotificationListParams) {
  const canView = usePermission('NOTI.NOTIFICATION.VIEW_OWN');

  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => notificationApi.getMyNotifications(params),
    enabled: canView,
    staleTime: 30_000,
    keepPreviousData: true,
  });
}
```

### 13.4 Mark read mutation

```ts
export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => notificationApi.markRead(notificationId),
    onMutate: async (notificationId) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: notificationKeys.unreadCount() }),
        queryClient.cancelQueries({ queryKey: notificationKeys.lists() }),
      ]);

      const previousUnread = queryClient.getQueryData(notificationKeys.unreadCount());

      queryClient.setQueryData(notificationKeys.unreadCount(), (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: {
            ...old.data,
            unread_count: Math.max(0, old.data.unread_count - 1),
          },
        };
      });

      return { previousUnread };
    },
    onError: (_error, _id, context) => {
      if (context?.previousUnread) {
        queryClient.setQueryData(notificationKeys.unreadCount(), context.previousUnread);
      }
    },
    onSettled: (_data, _error, notificationId) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dropdown() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.detail(notificationId) });
    },
  });
}
```

### 13.5 Mark all read mutation

```ts
export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      queryClient.setQueryData(notificationKeys.unreadCount(), (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: {
            ...old.data,
            unread_count: 0,
            high_priority_unread_count: 0,
            urgent_unread_count: 0,
          },
        };
      });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dropdown() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
    },
  });
}
```

---

## 14. Topbar notification integration

### 14.1 Component placement

`NotificationBellButton` nằm trong `TopbarActions` của protected layout.

```tsx
function TopbarActions() {
  return (
    <div className="flex items-center gap-2">
      <AppSwitcherButton />
      <PermissionGate permission="NOTI.NOTIFICATION.VIEW_OWN">
        <NotificationBellButton />
      </PermissionGate>
      <UserAvatarMenu />
    </div>
  );
}
```

### 14.2 NotificationBellButton behavior

| State | UI |
| --- | --- |
| Loading unread count | Bell hiển thị skeleton/dot nhẹ, không block topbar |
| Count = 0 | Bell bình thường |
| Count > 0 | Badge số, max display `99+` |
| Error unread count | Bell vẫn mở được, không show toast liên tục |
| No permission | Ẩn bell hoặc disabled theo policy |

### 14.3 Component skeleton

```tsx
export function NotificationBellButton() {
  const [open, setOpen] = useState(false);
  const unreadQuery = useUnreadCountQuery();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton aria-label="Thông báo">
          <BellIcon />
          {unreadQuery.data?.data.unread_count ? (
            <NotificationBadge count={unreadQuery.data.data.unread_count} />
          ) : null}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <NotificationDropdown open={open} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
```

---

## 15. Notification dropdown

### 15.1 Anatomy

```text
+------------------------------------------------+
| Thông báo                         5 chưa đọc   |
| [Tất cả] [Chưa đọc]                            |
|------------------------------------------------|
| [Task] Bạn được giao task mới       2 phút     |
|       Thiết kế màn Notification...      dot    |
| [Leave] Đơn nghỉ đã được duyệt       1 giờ     |
| [ATT] Bạn chưa check-out hôm qua     Hôm qua   |
|------------------------------------------------|
| [Đánh dấu tất cả đã đọc] [Xem tất cả]          |
+------------------------------------------------+
```

### 15.2 Rule

1. Load dropdown khi popover mở.
2. Mặc định lấy tối đa 7 item.
3. Có tab `Tất cả` và `Chưa đọc` ở client hoặc gọi lại API với `only_unread`.
4. Item unread có dot hoặc nền nhẹ.
5. Click item gọi `openTarget` hoặc `markRead + navigate` theo API khả dụng.
6. `Đánh dấu tất cả đã đọc` chỉ hiện khi unread count > 0 và user có `NOTI.NOTIFICATION.MARK_ALL_READ_OWN`.
7. Footer `Xem tất cả` điều hướng `/notifications`.
8. Empty state phải ngắn gọn.
9. Error state có nút thử lại, không spam toast.

### 15.3 Dropdown item behavior

```tsx
function handleClickNotification(item: NotificationSummaryDto) {
  if (!item.is_read) {
    markReadMutation.mutate(item.notification_id);
  }

  const targetUrl = normalizeNotificationTargetUrl(item.target_url);

  if (targetUrl) {
    navigate(targetUrl);
    return;
  }

  navigate(`/notifications/${item.notification_id}`);
}
```

### 15.4 Target URL normalization

```ts
export function normalizeNotificationTargetUrl(targetUrl?: string | null) {
  if (!targetUrl) return null;

  // Chỉ cho phép internal route để tránh open redirect.
  if (!targetUrl.startsWith('/')) return null;
  if (targetUrl.startsWith('//')) return null;

  return targetUrl;
}
```

---

## 16. My Notification List Page

### 16.1 Route

```text
/notifications
```

### 16.2 Screen metadata

| Thuộc tính | Nội dung |
| --- | --- |
| Screen code | `UI-NOTI-SCREEN-002` |
| Template | List |
| Permission | `NOTI.NOTIFICATION.VIEW_OWN` |
| Data scope | Own |
| API | `GET /api/v1/notifications` |
| Component | NotificationList, NotificationListItem, NotificationFilterBar |
| Priority | P0 |

### 16.3 Layout

```text
Breadcrumb: Home / Thông báo
PageHeader:
  Title: Thông báo của tôi
  Subtitle: Theo dõi các cập nhật quan trọng trong hệ thống
  Actions: [Đánh dấu tất cả đã đọc]

FilterBar:
  Search
  Status: All/Unread/Read/Archived
  Source module
  Priority
  Date range

Content:
  NotificationListItem[]
  Pagination
```

### 16.4 Filter params

| UI control | Query param |
| --- | --- |
| Search input | `search` |
| Tab Unread | `status=Unread` hoặc `read=false` |
| Tab Read | `status=Read` hoặc `read=true` |
| Tab Archived | `status=Archived&include_archived=true` |
| Module source | `source_module` |
| Priority | `priority` |
| Date range | `created_from`, `created_to` |
| Sort newest | `sort=created_at:desc` |

### 16.5 List item

| Field | UI |
| --- | --- |
| Module | Badge/icon HR, ATT, LEAVE, TASK, SYSTEM |
| Title | Dòng chính, bold nếu unread |
| Short content | 1-2 dòng |
| Time | Relative time + tooltip absolute |
| Priority | Badge nếu High/Urgent/Critical |
| Read state | Dot/unread background |
| Target | Button `Mở chi tiết` hoặc row click |
| Actions | Mark read/unread, archive, delete |

### 16.6 Empty states

| Context | Copy |
| --- | --- |
| Không có thông báo | `Bạn chưa có thông báo nào.` |
| Không có unread | `Bạn đã đọc hết thông báo.` |
| Filter không có kết quả | `Không tìm thấy thông báo phù hợp với bộ lọc.` |
| No data due to scope | `Không có thông báo trong phạm vi của bạn.` |

---

## 17. Notification Detail Page

### 17.1 Route

```text
/notifications/:notificationId
```

### 17.2 Screen metadata

| Thuộc tính | Nội dung |
| --- | --- |
| Screen code | `UI-NOTI-SCREEN-003` |
| Template | Detail |
| Permission | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |
| Data scope | Own |
| API | `GET /api/v1/notifications/{notification_id}` |
| Component | NotificationDetailPanel, NotificationTargetButton, Timeline optional |
| Priority | P1 |

### 17.3 Layout

```text
Breadcrumb: Thông báo / Chi tiết
PageHeader:
  Title: {notification.title}
  Status: Read/Unread
  Actions: [Mở nội dung gốc] [Mark read/unread] [Archive]

Summary card:
  Module, Event code, Priority, Created at, Read at

Content:
  Full content
  Safe payload display nếu có

Target:
  CTA mở module gốc
  Target unavailable state nếu không có target hoặc không mở được
```

### 17.4 Auto mark read policy

Có 2 lựa chọn triển khai tùy backend:

| Policy | Frontend behavior |
| --- | --- |
| Backend auto mark read khi GET detail | Sau load detail invalidate unread count/dropdown |
| Frontend chủ động mark read sau khi mở detail | Gọi mark read nếu `is_read=false` và có permission |

Khuyến nghị MVP:

```text
GET detail không bắt buộc auto mark read.
Frontend gọi mark read rõ ràng khi user click item hoặc mở detail.
```

### 17.5 Target unavailable state

Hiển thị khi:

1. `target_url` null.
2. `open-target` trả `can_open=false`.
3. Route guard trả 403.
4. Module target trả 404/410.
5. User mất quyền sau khi notification được tạo.

Copy:

```text
Bạn không thể mở nội dung này.
Nội dung có thể đã bị xóa, thay đổi trạng thái hoặc bạn không còn quyền truy cập.
```

---

## 18. Deep link handling

### 18.1 Flow chuẩn

```text
User click notification item
-> Nếu unread: mark read optimistic
-> Resolve target_url
-> Validate target_url là internal path
-> Navigate target route
-> Route guard kiểm tra permission
-> Module target gọi API gốc
-> Nếu 403/404: show Forbidden/TargetUnavailable
```

### 18.2 Event target mapping tham khảo

| Event | Target route | Module gốc |
| --- | --- | --- |
| `LEAVE_REQUEST_SUBMITTED` | `/leave/approvals` hoặc `/leave/requests/:id` | LEAVE |
| `LEAVE_REQUEST_APPROVED` | `/leave/requests/:id` | LEAVE |
| `ATT_ADJUSTMENT_SUBMITTED` | `/attendance/adjustment-requests/:id` | ATT |
| `TASK_ASSIGNED` | `/tasks/:taskId` | TASK |
| `TASK_MENTIONED` | `/tasks/:taskId` | TASK |
| `ATT_MISSING_CHECKOUT` | `/attendance/today` | ATT |
| `HR_PROFILE_CHANGE_SUBMITTED` | `/hr/profile-change-requests/:id` | HR |

### 18.3 Không hard-code toàn bộ target ở frontend

Frontend chỉ nên có fallback mapping tối thiểu. Nguồn chính là `target_url` hoặc `open-target` response từ backend.

```ts
export function resolveNotificationTarget(notification: NotificationSummaryDto) {
  const safeUrl = normalizeNotificationTargetUrl(notification.target_url);
  if (safeUrl) return safeUrl;

  // Fallback rất hạn chế cho trường hợp backend chưa trả target_url.
  if (notification.event_code === 'ATT_MISSING_CHECKOUT') {
    return '/attendance/today';
  }

  return `/notifications/${notification.notification_id}`;
}
```

---

## 19. Admin Notification Events Page

### 19.1 Route

```text
/notifications/events
```

### 19.2 Screen metadata

| Thuộc tính | Nội dung |
| --- | --- |
| Screen code | `UI-NOTI-SCREEN-004` |
| Template | Settings/List |
| Permission | `NOTI.EVENT.VIEW` |
| Data scope | Company/System |
| API | `GET /api/v1/notifications/events` |
| Primary action | Không bắt buộc trong MVP |

### 19.3 Table columns

| Cột | Nội dung |
| --- | --- |
| Event code | `TASK_ASSIGNED`, `LEAVE_REQUEST_APPROVED` |
| Module | AUTH/HR/ATT/LEAVE/TASK/SYSTEM |
| Name | Tên dễ hiểu |
| Default type | Task, Leave, Warning... |
| Priority | Normal/High/Urgent... |
| Dedupe | Bật/tắt + window |
| Enabled | Switch nếu có `NOTI.EVENT.CONFIG` |
| Updated at | Thời gian cập nhật |
| Action | Detail/Edit nếu có quyền |

### 19.4 UX rule

1. Search theo event code, name, module.
2. Filter theo module/status.
3. Switch enable/disable cần confirm nếu event quan trọng.
4. Nếu event bị tắt, show warning: module nguồn vẫn phát event nhưng NOTI sẽ bỏ qua.
5. Ghi audit ở backend; frontend chỉ hiển thị toast và refresh.

---

## 20. Notification Templates Page

### 20.1 Route

```text
/notifications/templates
/notifications/templates/new
/notifications/templates/:templateId
```

### 20.2 Screen metadata

| Thuộc tính | Nội dung |
| --- | --- |
| Screen code | `UI-NOTI-SCREEN-005` |
| Template | Settings/List/Form |
| Permission | `NOTI.TEMPLATE.VIEW`, `NOTI.TEMPLATE.CREATE`, `NOTI.TEMPLATE.UPDATE`, `NOTI.TEMPLATE.DELETE` |
| Data scope | Company/System |
| API | `/api/v1/notifications/templates` |
| Priority | P2 |

### 20.3 Template list columns

| Cột | Nội dung |
| --- | --- |
| Template code | `TASK_ASSIGNED_IN_APP_VI` |
| Event code | Event liên kết |
| Channel | IN_APP/EMAIL/PUSH |
| Locale | vi/en |
| Title template | Preview ngắn |
| Status | Active/Inactive/Draft |
| Default | Có/Không |
| Updated at | Thời gian cập nhật |
| Action | View/Edit/Delete/Preview |

### 20.4 Template form fields

| Field | Component | Validation |
| --- | --- | --- |
| Event code | Select/Combobox | Required |
| Channel | Select | Required, MVP default IN_APP |
| Locale | Select | Required |
| Template code | Input | Required, unique |
| Title template | Input | Required |
| Short template | Textarea | Required |
| Content template | Rich/Plain textarea | Required |
| Variables schema | JSON editor collapsed | Optional |
| Status | Select | Required |
| Is default | Switch | Optional |

### 20.5 Preview panel

Form nên có side panel preview:

```text
Variables JSON
{
  "task_title": "Thiết kế module Notification",
  "project_name": "EMS MVP"
}

[Preview]
Title: Bạn có task mới
Short: Bạn được giao task Thiết kế module Notification
Content: Bạn được giao task Thiết kế module Notification trong dự án EMS MVP.
```

### 20.6 Dirty form guard

Nếu template form có thay đổi chưa lưu:

1. Rời route phải confirm.
2. Đổi app bằng App Switcher phải confirm.
3. Đóng drawer/modal phải confirm.

---

## 21. Delivery Logs Page

### 21.1 Route

```text
/notifications/delivery-logs
```

### 21.2 Screen metadata

| Thuộc tính | Nội dung |
| --- | --- |
| Screen code | `UI-NOTI-SCREEN-006` |
| Template | Audit/Table |
| Permission | `NOTI.LOG.VIEW` |
| Data scope | Company/System |
| API | `GET /api/v1/notifications/delivery-logs` |
| Priority | P2 |

### 21.3 Table columns

| Cột | Nội dung |
| --- | --- |
| Time | Created/sent time |
| Notification | Notification id/title nếu có |
| Recipient | User/employee nếu API trả snapshot |
| Channel | IN_APP/EMAIL/PUSH |
| Provider | internal/provider name |
| Status | Pending/Sent/Failed/Skipped |
| Attempt | attempt_no/max_attempts |
| Error | error_code/error_message rút gọn |
| Next retry | next_retry_at |
| Action | Retry nếu failed và có quyền |

### 21.4 Retry action

1. Chỉ hiện nếu có `NOTI.LOG.RETRY`.
2. Chỉ enable khi status `Failed` hoặc `Pending` quá hạn theo backend rule.
3. Confirm trước khi retry.
4. Sau retry invalidate delivery logs.

---

## 22. Channel Config Page

### 22.1 Route

```text
/notifications/channels
```

### 22.2 MVP behavior

MVP chỉ cần cấu hình IN_APP ở mức cơ bản. EMAIL/PUSH/REALTIME có thể hiển thị disabled/coming soon nếu backend trả config.

| Channel | UI MVP |
| --- | --- |
| IN_APP | Active, configurable |
| EMAIL | Disabled hoặc basic toggle nếu backend hỗ trợ |
| PUSH | Coming soon |
| REALTIME | Coming soon |
| INTEGRATION | Coming soon |

### 22.3 Config fields

| Field | Ý nghĩa |
| --- | --- |
| Enabled | Bật/tắt channel |
| Default priority threshold | Gửi từ priority nào |
| Retention days | Số ngày giữ notification/log |
| Allow user preference | Cho user cá nhân tùy chỉnh hay không |

---

## 23. System Notification Page

### 23.1 Route

```text
/notifications/system/new
```

### 23.2 Permission

| Action | Permission |
| --- | --- |
| Tạo draft/system notification | `NOTI.NOTIFICATION.CREATE_SYSTEM` |
| Gửi system notification | `NOTI.NOTIFICATION.SEND_SYSTEM` |

### 23.3 Form fields

| Field | Component | Validation |
| --- | --- | --- |
| Title | Input | Required |
| Short content | Textarea | Required |
| Content | Textarea/Rich text | Required |
| Priority | Select | Required |
| Recipient mode | Select | Required |
| Role/Department/User recipients | Combobox multi | Theo mode |
| Send now / Save draft | Radio | Required |
| Expire at | DateTimePicker | Optional |

### 23.4 Safety UX

1. System notification là thao tác nhạy cảm, cần preview trước khi gửi.
2. Nếu recipient mode là `Company` hoặc số lượng lớn, cần confirm rõ số người nhận.
3. Không cho gửi nếu title/content rỗng hoặc quá dài.
4. Sau khi gửi, điều hướng đến delivery log hoặc show result summary.

---

## 24. Permission behavior

### 24.1 Permission matrix frontend

| UI element/action | Permission |
| --- | --- |
| Topbar bell | `NOTI.NOTIFICATION.VIEW_OWN` |
| Unread count | `NOTI.NOTIFICATION.COUNT_UNREAD_OWN` |
| Notification list | `NOTI.NOTIFICATION.VIEW_OWN` |
| Notification detail | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |
| Mark read | `NOTI.NOTIFICATION.MARK_READ_OWN` |
| Mark all read | `NOTI.NOTIFICATION.MARK_ALL_READ_OWN` |
| Hide | `NOTI.NOTIFICATION.HIDE_OWN` |
| Archive | `NOTI.NOTIFICATION.HIDE_OWN` |
| Delete soft | `NOTI.NOTIFICATION.DELETE_OWN` |
| Admin notification list | `NOTI.NOTIFICATION.VIEW_COMPANY` |
| Create system notification | `NOTI.NOTIFICATION.CREATE_SYSTEM` |
| Send system notification | `NOTI.NOTIFICATION.SEND_SYSTEM` |
| Event list | `NOTI.EVENT.VIEW` |
| Event config | `NOTI.EVENT.CONFIG` |
| Template list | `NOTI.TEMPLATE.VIEW` |
| Template create | `NOTI.TEMPLATE.CREATE` |
| Template update | `NOTI.TEMPLATE.UPDATE` |
| Template delete | `NOTI.TEMPLATE.DELETE` |
| Channel view | `NOTI.CHANNEL.VIEW` |
| Channel update | `NOTI.CHANNEL.UPDATE` |
| Delivery log view | `NOTI.LOG.VIEW` |
| Delivery log retry | `NOTI.LOG.RETRY` |

### 24.2 Data scope

| Scope | Frontend behavior |
| --- | --- |
| Own | Chỉ màn cá nhân: dropdown/list/detail/action của chính user |
| Company | Admin config/log trong company |
| System | Super Admin nếu có route/system mode |
| Team/Department | Có thể chừa cho phase sau, không áp dụng mạnh trong MVP NOTI |

### 24.3 Không hard-code role

Không viết:

```ts
if (user.role === 'HR') showTemplateConfig();
```

Phải viết:

```tsx
<PermissionGate permission="NOTI.TEMPLATE.VIEW">
  <NotificationTemplatesPage />
</PermissionGate>
```

---

## 25. State management

### 25.1 Page states bắt buộc

| State | Dropdown | List | Detail | Admin pages |
| --- | --- | --- | --- | --- |
| Loading | Skeleton item | Skeleton list | Skeleton detail | Table skeleton |
| Empty | Empty compact | Empty contextual | Target empty | Empty table |
| Error | Inline mini error | ErrorState + retry | ErrorState + retry | ErrorState + request id |
| Forbidden | Hide bell | Forbidden page | Forbidden page | Forbidden page |
| Stale | Optional | Last updated | Last updated | Last updated |
| Degraded | Show cached if any | Show stale data | Show target unavailable | Show warning |

### 25.2 Error mapping

| API error | UI behavior |
| --- | --- |
| 401 | AuthProvider xử lý refresh/logout |
| 403 | ForbiddenState, không retry vô hạn |
| 404 detail | Target/notification not found |
| 409 business rule | Alert/Toast warning |
| 422 validation | Inline form error |
| 429 rate limit | Toast warning + disable retry tạm thời |
| 500 | ErrorState + request id + retry |

---

## 26. Responsive design

### 26.1 Desktop

| Thành phần | Behavior |
| --- | --- |
| Topbar dropdown | Popover width 360-420px, align end |
| List page | 2-column optional: list + detail preview drawer |
| Admin tables | Full table, filter bar ngang |
| Template editor | Form left + preview right |

### 26.2 Tablet

| Thành phần | Behavior |
| --- | --- |
| Dropdown | Drawer hoặc popover rộng hơn |
| List | Card/list, filter collapsible |
| Detail | Full page |
| Admin tables | Horizontal scroll hoặc column priority |

### 26.3 Mobile web

| Thành phần | Behavior |
| --- | --- |
| Bell | Fullscreen notification list thay popover |
| Dropdown | Chuyển thành bottom sheet/fullscreen |
| Filter | Drawer filter |
| List item | Card compact |
| Admin config | Khuyến nghị desktop; mobile chỉ view cơ bản |

---

## 27. Accessibility

1. Bell button có `aria-label="Thông báo"`.
2. Badge unread count cần accessible text: `5 thông báo chưa đọc`.
3. Dropdown trap focus khi mở nếu dùng popover/modal behavior.
4. Keyboard navigation: Tab qua item/action, Enter mở item, Escape đóng dropdown.
5. Item unread không chỉ dựa vào màu; cần dot/icon/text state.
6. Toast không là nơi duy nhất truyền lỗi quan trọng; page/action cần inline feedback.
7. Action danger như delete cần confirm dialog accessible.
8. Relative time có tooltip hoặc `title` chứa thời gian đầy đủ.

---

## 28. Mock API strategy

### 28.1 MSW handlers

```ts
export const notificationHandlers = [
  http.get('/api/v1/notifications/unread-count', () => {
    return HttpResponse.json(successResponse({
      unread_count: 5,
      high_priority_unread_count: 1,
      urgent_unread_count: 0,
      last_notification_at: '2026-06-20T10:00:00+07:00',
    }));
  }),

  http.get('/api/v1/notifications/dropdown', () => {
    return HttpResponse.json(successResponse(notificationDropdownFixture));
  }),

  http.get('/api/v1/notifications', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    return HttpResponse.json(paginatedResponse(filterNotificationFixtures({ status })));
  }),

  http.post('/api/v1/notifications/:id/mark-read', ({ params }) => {
    return HttpResponse.json(successResponse({ notification_id: params.id, status: 'Read' }));
  }),
];
```

### 28.2 Fixture events nên có

| Event | Mục tiêu test |
| --- | --- |
| `TASK_ASSIGNED` | Deep link task detail |
| `TASK_MENTIONED` | Deep link task comment |
| `LEAVE_REQUEST_APPROVED` | Deep link leave request |
| `ATT_ADJUSTMENT_SUBMITTED` | Deep link attendance approval |
| `ATT_MISSING_CHECKOUT` | Deep link attendance today |
| `HR_PROFILE_CHANGE_SUBMITTED` | Deep link HR request |
| `SYSTEM_ANNOUNCEMENT` | Notification không có target nghiệp vụ |

---

## 29. Testing strategy

### 29.1 Unit tests

| Test | Nội dung |
| --- | --- |
| `normalizeNotificationTargetUrl` | Chặn external URL, `//evil.com`, null |
| `resolveNotificationTarget` | Fallback route đúng |
| Permission utility | Bell/list/action chỉ hiện khi có permission |
| Notification display mapper | Priority/module/status badge đúng |
| Query key factory | Key ổn định theo params |
| Mutation optimistic update | Mark read giảm unread count và rollback khi lỗi |

### 29.2 Component tests

| Component | Test |
| --- | --- |
| NotificationBadge | 0, 1, 99, 100 -> `99+` |
| NotificationDropdown | Loading, empty, error, loaded, mark all read |
| NotificationListItem | Unread style, action menu, target CTA |
| NotificationDetailPanel | Read/unread, target available/unavailable |
| NotificationTemplateEditor | Validation, dirty guard, preview |
| DeliveryLogTable | Failed status, retry action permission |

### 29.3 Integration tests

1. Load protected layout -> gọi unread count -> show badge.
2. Click bell -> gọi dropdown -> show latest notifications.
3. Click unread item -> mark read -> badge giảm -> navigate target.
4. Click mark all read -> unread count về 0 -> dropdown/list cập nhật.
5. Mở `/notifications` -> filter unread -> list đúng params.
6. Mở detail notification không thuộc owner -> API 403/404 -> Forbidden/Not found.
7. Admin thiếu `NOTI.TEMPLATE.VIEW` -> không thấy menu Templates.
8. Retry delivery log thiếu quyền -> action không xuất hiện.

### 29.4 E2E tests

| Flow | Kịch bản |
| --- | --- |
| FE12-E2E-001 | User có unread notification, mở dropdown, mark read thành công |
| FE12-E2E-002 | User click `TASK_ASSIGNED`, đi sang task detail, route guard chạy |
| FE12-E2E-003 | User mất quyền target sau khi nhận notification, click target thấy Forbidden |
| FE12-E2E-004 | User vào list, search/filter/pagination hoạt động |
| FE12-E2E-005 | Mark all read chỉ ảnh hưởng notification của user hiện tại |
| FE12-E2E-006 | Admin cấu hình event/template nếu có quyền |
| FE12-E2E-007 | Mobile mở bell thành fullscreen list/bottom sheet |

---

## 30. Security checklist

1. Không lưu notification payload nhạy cảm vào localStorage.
2. Không log full notification payload ở console production.
3. Không điều hướng external URL từ notification target.
4. Không tin `target_url` nếu không bắt đầu bằng `/`.
5. Không render HTML từ template/content nếu chưa sanitize.
6. Nếu backend trả rich content, phải sanitize hoặc render dạng plain text.
7. Không hiển thị notification của user khác dù biết UUID.
8. Không hard-code role.
9. Không bỏ qua route guard khi deep link.
10. Clear notification cache khi logout hoặc đổi user/company.
11. Admin pages phải qua permission route guard.
12. Dangerous action như delete/retry/send system notification cần confirm.

---

## 31. Performance checklist

1. Unread count query nhẹ, không block layout.
2. Dropdown lazy load khi mở.
3. List page dùng pagination, không load tất cả.
4. Filter debounce search 300-500ms.
5. Không refetch unread count quá dày khi tab inactive.
6. Dùng `keepPreviousData` cho list pagination.
7. Admin delivery log query có filter thời gian mặc định.
8. Không render JSON payload lớn trong table; dùng detail drawer collapsed.
9. Virtualization có thể dùng nếu delivery log nhiều, không bắt buộc MVP.
10. Chỉ invalidate đúng nhóm query sau mutation.

---

## 32. Sprint triển khai đề xuất

### Sprint FE12.1 - User notification core

1. Tạo `notification.types.ts`.
2. Tạo `notification.api.ts`.
3. Tạo query key factory.
4. Tạo `useUnreadCountQuery`.
5. Tạo `NotificationBadge` và `NotificationBellButton`.
6. Tích hợp bell vào Topbar.
7. Tạo mock API unread count/dropdown.

### Sprint FE12.2 - Dropdown + actions

1. Tạo `NotificationDropdown`.
2. Tạo `NotificationDropdownItem`.
3. Implement mark read.
4. Implement mark all read.
5. Implement item click + safe target navigation.
6. Loading/empty/error state.
7. Component tests.

### Sprint FE12.3 - My Notification Workspace

1. Tạo `/notifications` route.
2. Tạo `NotificationFilterBar`.
3. Tạo `NotificationList` và `NotificationListItem`.
4. Search/filter/sort/pagination.
5. Row actions: mark read/unread, archive, delete.
6. Tạo `/notifications/:notificationId` detail page.
7. Target unavailable state.

### Sprint FE12.4 - Admin config MVP

1. Event list page.
2. Event enable/disable switch.
3. Template list page.
4. Template create/update form.
5. Template preview.
6. Channel config page cơ bản.
7. Permission guard menu/route/action.

### Sprint FE12.5 - Logs, system notification, hardening

1. Delivery logs page.
2. Retry delivery log action.
3. System notification form.
4. Confirm + preview before send.
5. E2E tests.
6. Responsive mobile/tablet.
7. Security/performance review.

---

## 33. Acceptance criteria

### 33.1 Core user notification

| Mã | Tiêu chí |
| --- | --- |
| FE12-AC-001 | Topbar hiển thị bell nếu user có `NOTI.NOTIFICATION.VIEW_OWN` |
| FE12-AC-002 | Badge dùng `GET /api/v1/notifications/unread-count` |
| FE12-AC-003 | Badge không block layout khi API lỗi |
| FE12-AC-004 | Dropdown chỉ load khi mở hoặc theo strategy đã chốt |
| FE12-AC-005 | Dropdown giới hạn 5-7 item trong MVP |
| FE12-AC-006 | Click mark all read cập nhật unread count/dropdown/list |
| FE12-AC-007 | Mark read chỉ áp dụng notification của user hiện tại |
| FE12-AC-008 | Không có permission thì không hiển thị bell hoặc action tương ứng |

### 33.2 List/detail/deep link

| Mã | Tiêu chí |
| --- | --- |
| FE12-AC-009 | `/notifications` có search/filter/sort/pagination |
| FE12-AC-010 | List item phân biệt read/unread rõ ràng |
| FE12-AC-011 | Detail page hiển thị content, metadata, target CTA |
| FE12-AC-012 | Deep link luôn đi qua route guard/module guard |
| FE12-AC-013 | Target URL external bị chặn |
| FE12-AC-014 | Target mất quyền/xóa hiển thị TargetUnavailable/Forbidden thân thiện |
| FE12-AC-015 | Notification payload không render HTML nguy hiểm |

### 33.3 Admin notification

| Mã | Tiêu chí |
| --- | --- |
| FE12-AC-016 | Event/template/channel/log menu chỉ hiện theo permission |
| FE12-AC-017 | Event enable/disable có confirm nếu cần |
| FE12-AC-018 | Template form có validation và dirty form guard |
| FE12-AC-019 | Template preview render được từ variables mẫu |
| FE12-AC-020 | Delivery log retry chỉ hiện nếu có `NOTI.LOG.RETRY` |
| FE12-AC-021 | System notification có preview + confirm trước khi gửi |

### 33.4 Quality

| Mã | Tiêu chí |
| --- | --- |
| FE12-AC-022 | Có unit test cho target URL normalization |
| FE12-AC-023 | Có component test cho dropdown/list item |
| FE12-AC-024 | Có integration test cho mark read/mark all read invalidation |
| FE12-AC-025 | Có E2E test deep link sang TASK/LEAVE/ATT ít nhất một flow |
| FE12-AC-026 | Responsive mobile: bell mở fullscreen/bottom sheet list |
| FE12-AC-027 | Logout clear notification query cache |

---

## 34. Definition of Done cho FRONTEND-12

FRONTEND-12 được xem là hoàn thành khi:

1. Có route `/notifications` và `/notifications/:notificationId` chạy trong ModuleWorkspaceLayout.
2. Có Topbar notification bell + unread badge.
3. Có notification dropdown với loading/empty/error/loaded state.
4. Có notification list với filter/search/sort/pagination.
5. Có notification detail với target CTA và target unavailable state.
6. Có các mutation mark read, mark all read, hide/archive/delete theo API.
7. Có query key/invalidation rõ ràng.
8. Có permission guard cho route/menu/action.
9. Có safe target URL normalization, không open redirect.
10. Có admin event/template/channel/log/system notification screen nếu phạm vi MVP yêu cầu.
11. Có mock API/MSW fixtures cho phát triển độc lập.
12. Có unit/component/integration/E2E test tối thiểu.
13. Có responsive desktop/tablet/mobile cho màn P0.
14. Có security checklist được review.
15. Có performance checklist được review.
16. Không có hard-code role trong NOTI frontend.
17. Không render dữ liệu ngoài owner/scope nếu API trả lỗi.
18. Tài liệu đủ để chuyển sang FRONTEND-13 hoặc FRONTEND-14.

---

## 35. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Unread count refetch quá nhiều | Tốn tài nguyên, topbar chậm | staleTime hợp lý, refetch khi focus/open dropdown |
| Optimistic update sai | Badge lệch | Rollback khi lỗi, invalidate sau mutation |
| Deep link bỏ qua permission | Lộ dữ liệu target | Route guard + API guard module gốc |
| Target URL unsafe | Open redirect | Chỉ cho internal path bắt đầu bằng `/` |
| Payload chứa HTML/script | XSS | Render plain text hoặc sanitize |
| Admin action hiện sai | Cấu hình nhầm/spam notification | PermissionGate, confirm, audit backend |
| Delivery log nhiều | Table chậm | Filter thời gian mặc định, pagination |
| Hard-code role | Sai khi role thay đổi | Dùng permission/data scope utilities |
| Cache user cũ sau logout | Lộ notification | Clear query cache khi logout/đổi user |
| Mobile dropdown khó dùng | UX kém | Chuyển thành fullscreen/bottom sheet |

---

## 36. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE12-OQ-001 | `GET /notifications/{id}` có auto mark read không hay FE gọi riêng? | BE/FE | Cao |
| FE12-OQ-002 | Dropdown endpoint trả pagination hay chỉ `limit`? | BE | Trung bình |
| FE12-OQ-003 | `open-target` có bắt buộc trong MVP không hay dùng `target_url` trực tiếp? | BE/FE | Cao |
| FE12-OQ-004 | Có hỗ trợ mark unread trong MVP không? | Product/BE | Thấp |
| FE12-OQ-005 | Archive và hide có khác nhau ở UI MVP không? | Product/UX | Trung bình |
| FE12-OQ-006 | Admin system notification có cần draft flow không? | Product/BE/FE | Trung bình |
| FE12-OQ-007 | Template content có plain text hay rich text? | Product/UX/BE | Trung bình |
| FE12-OQ-008 | Realtime/polling unread count có cần trong MVP không? | Product/Tech Lead | Trung bình |
| FE12-OQ-009 | Notification preference cá nhân đưa vào MVP hay phase sau? | Product | Thấp |
| FE12-OQ-010 | TargetUnavailable dùng page riêng hay component trong module target? | UX/FE | Thấp |

---

## 37. Kết luận

FRONTEND-12 hoàn thiện lớp frontend cho module NOTI theo hướng:

```text
Topbar badge nhẹ
-> Dropdown xem nhanh
-> List/detail đầy đủ
-> Action read/archive/delete rõ ràng
-> Deep link an toàn sang module gốc
-> Admin config theo permission
-> Query/invalidation ổn định
-> Không hard-code role
-> Không bỏ qua backend guard
```

Sau FRONTEND-12, đội frontend có thể tiếp tục:

```text
FRONTEND-13: System/Foundation Frontend
FRONTEND-14: QA, Performance & Release Readiness
```
