> ⚠️ **ĐÍNH CHÍNH STACK (bắt buộc) — đọc trước:** Tài liệu này có thể còn nhắc Next.js/Prisma (lỗi thời). Stack đã CHỐT: **Vite + React 19 SPA + TanStack Router (KHÔNG Next.js)** · **Drizzle (KHÔNG Prisma)** · **Valkey** · **Vitest**. Các token an toàn đã thay inline; phần khái niệm lấy [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md) làm chuẩn.

# FRONTEND-05: LAYOUT IMPLEMENTATION

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · **FRONTEND-05 Layout** · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Module Workspace: UI-07](<../UI/UI-07_Module_Workspace_Template_Design.md>) · [Home/App Switcher: UI-06](<../UI/UI-06_Home_Portal_App_Switcher_UI_Design.md>) · [UI/UX Tổng quan: UI-01](<../UI/UI-01_UIUX_Design_Tong_Quan.md>) · [Kiến trúc FE: FRONTEND-01](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-05 |
| Tên tài liệu | Layout Implementation |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-04 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-05 mô tả cách triển khai lớp **layout frontend** cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chuyển các quyết định UI/UX về Home Portal, Module Workspace, App Switcher, Topbar và Sidebar thành cấu trúc code frontend rõ ràng.
2. Chuẩn hóa các layout chính: `AuthLayout`, `ProtectedShell`, `HomePortalLayout`, `ModuleWorkspaceLayout`, `GlobalTopbar`, `ModuleSidebar`, `MainContentShell`, `AppSwitcher`.
3. Đảm bảo mọi module nghiệp vụ dùng chung một layout nền, tránh mỗi module tự dựng topbar/sidebar/form shell riêng.
4. Kết nối layout với session, permission, data scope, app registry, route metadata, sidebar registry và notification badge đã được định hướng ở các tài liệu frontend trước.
5. Chuẩn hóa cách layout xử lý loading, empty, error, forbidden, module disabled, stale data và responsive behavior.
6. Đảm bảo frontend chỉ hỗ trợ trải nghiệm bằng ẩn/hiện/disable/guard UI, không thay thế backend authorization.
7. Làm nền để triển khai các tài liệu tiếp theo: AUTH & Account, Dashboard, HR, Attendance, Leave, Task, Notification và System/Foundation Frontend.

---

## 3. Vị trí FRONTEND-05 trong roadmap frontend

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

FRONTEND-05 nằm sau routing/auth/permission và API/query layer vì layout cần dùng:

1. Session context từ `/api/v1/auth/me`.
2. Permission checker từ FRONTEND-03.
3. API client và query hooks từ FRONTEND-04.
4. App registry và sidebar registry để render Home Portal, App Switcher và Module Workspace.
5. Notification unread count để hiển thị badge ở topbar.
6. Error mapper để chuyển lỗi layout-level thành state phù hợp.

---

## 4. Căn cứ triển khai

FRONTEND-05 bám theo các quyết định đã chốt:

1. Sau đăng nhập, user vào **Home Portal** trước, không đi thẳng vào dashboard nghiệp vụ.
2. Từ Home Portal, user chọn app/module để vào **Module Workspace**.
3. Trong mọi màn protected, user có thể mở **App Switcher** để đổi module.
4. Module Workspace dùng **Topbar chung toàn hệ thống** và **Sidebar riêng theo module**.
5. App, menu, route, button, widget, badge và field hiển thị theo permission và data scope.
6. Menu không hard-code theo role. Role chỉ là seed mặc định; permission/data scope mới là nguồn kiểm tra chính.
7. Dashboard, Home Portal và App Switcher chỉ tổng hợp/điều hướng, không xử lý nghiệp vụ gốc.
8. Notification deep link và Dashboard quick action phải điều hướng về module gốc để module đó kiểm tra quyền và business rule lại.
9. Layout phải dùng lại Design System: token, component foundation, state component, PermissionGate, ForbiddenState, DisabledActionTooltip, MaskedField.
10. Layout phải dùng API/query layer chung, không tự gọi `fetch` rời rạc.
11. Khi logout phải clear session, sensitive query cache, app/sidebar/action cache theo user.
12. Layout phải có responsive behavior rõ cho desktop, tablet và mobile web.

---

## 5. Phạm vi FRONTEND-05

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Layout architecture | AuthLayout, ProtectedShell, HomePortalLayout, ModuleWorkspaceLayout |
| Global navigation | GlobalTopbar, Home button, current app indicator, app switcher trigger, notification badge, avatar menu |
| Module navigation | ModuleSidebar, sidebar group, sidebar item, active state, badge, collapse, mobile drawer |
| Home Portal shell | Header, app grid container, recent/favorite apps area, quick access area |
| App Switcher | Overlay/drawer/fullscreen mobile, app search, app list, recent apps, favorite apps, locked/coming soon state |
| Content shell | MainContentShell, PageHeader, Breadcrumb, PageToolbar, PageBody, RightDrawer slot, Modal slot |
| Layout state | Sidebar collapsed, mobile sidebar open, app switcher open, dirty form guard, topbar search state |
| Permission layout | Hide/disable/forbidden layout regions theo permission, data scope và module status |
| Data integration | Load session, app registry, sidebar menu, notification unread count, user menu data |
| Responsive | Desktop, tablet, mobile web behavior |
| Accessibility | Keyboard navigation, focus trap, aria-label, skip link, semantic landmark |
| Testing | Unit/component/E2E checklist cho layout |
| Handoff | Folder structure, component API, code skeleton, Definition of Done |

### 5.2 Không bao gồm

| Nội dung | Chuyển sang |
| --- | --- |
| Login/forgot/reset password screen chi tiết | FRONTEND-06 |
| User/role/permission admin CRUD | FRONTEND-06 / FRONTEND-13 |
| Dashboard widget chi tiết | FRONTEND-07 |
| HR/ATT/LEAVE/TASK/NOTI screen nghiệp vụ | FRONTEND-08 -> FRONTEND-12 |
| Notification list/detail đầy đủ | FRONTEND-12 |
| System settings/audit/file UI chi tiết | FRONTEND-13 |
| E2E full regression plan | FRONTEND-14 |
| CI/CD/deploy/release | FRONTEND-14 hoặc DevOps |

---

## 6. Nguyên tắc thiết kế layout

### 6.1 Layout là app shell, không phải business logic

Layout được phép xử lý:

1. Điều hướng.
2. Hiển thị app/menu/action theo permission metadata.
3. Hiển thị trạng thái layout: loading, forbidden, module disabled, maintenance.
4. Mở/đóng App Switcher, Sidebar, Avatar menu, Notification dropdown.
5. Giữ trạng thái UI không nhạy cảm như sidebar collapsed.
6. Gọi query layout-level như session, app registry, unread count.

Layout không xử lý:

1. Check-in có hợp lệ hay không.
2. Đơn nghỉ có đủ số dư phép hay không.
3. Task có thể chuyển trạng thái hay không.
4. Employee field nào được cập nhật hay không.
5. Dữ liệu nào thuộc scope nào ở backend.

### 6.2 Permission-driven, không role-driven

Không viết layout theo role:

```ts
if (user.role === 'HR') showHrMenu();
```

Phải dựa vào registry và permission checker:

```ts
const visibleItems = filterSidebarItems(sidebarItems, permission, session.modules);
```

### 6.3 Một topbar chung cho protected area

Mọi màn sau đăng nhập đều dùng `GlobalTopbar`, bao gồm:

1. Home Portal.
2. Module Workspace.
3. Account/Profile pages.
4. Error pages trong protected area.

Topbar giúp user luôn có cách:

1. Về Home Portal.
2. Biết app/module hiện tại.
3. Mở App Switcher.
4. Xem notification.
5. Mở avatar menu/logout.

### 6.4 Một ModuleWorkspaceLayout dùng cho mọi module

Các module không tự dựng layout riêng.

Đúng:

```tsx
<ModuleWorkspaceLayout moduleCode="HR">
  <EmployeeListPage />
</ModuleWorkspaceLayout>
```

Không nên:

```tsx
<HrTopbar />
<HrSidebar />
<EmployeeListPage />
```

### 6.5 Layout state phải tách khỏi server-state

Server-state dùng TanStack Query:

```text
session
my apps
sidebar badge count
notification unread count
```

Client-state dùng Zustand/Context:

```text
sidebar collapsed
mobile sidebar open
app switcher open
dirty form confirm
active command palette/search
```

### 6.6 Backend vẫn là guard cuối cùng

Frontend có thể:

1. Ẩn menu user không có quyền.
2. Disable button khi thiếu điều kiện.
3. Chặn route bằng guard.
4. Hiển thị forbidden state.

Nhưng backend vẫn phải kiểm tra authentication, permission, data scope và business rule với mọi API.

---

## 7. Layout architecture tổng thể

### 7.1 Sơ đồ layout cấp cao

```text
AppProviders
  -> QueryProvider
  -> AuthSessionProvider
  -> PermissionProvider
  -> ThemeProvider
  -> ToastProvider
  -> DialogProvider
  -> LayoutStateProvider

Public Route
  -> AuthLayout
     -> Login/Forgot/Reset pages

Protected Route
  -> ProtectedShell
     -> GlobalTopbar
     -> LayoutStateBoundary
     -> route.layout = HOME_PORTAL
        -> HomePortalLayout
     -> route.layout = MODULE_WORKSPACE
        -> ModuleWorkspaceLayout
           -> ModuleSidebar
           -> MainContentShell
     -> route.layout = ACCOUNT
        -> AccountLayout
     -> AppSwitcher
     -> NotificationDropdown
     -> GlobalModalLayer
     -> GlobalToastLayer
```

### 7.2 Route layout mapping

| `layout` trong route meta | Component render | Ghi chú |
| --- | --- | --- |
| `AUTH` | `AuthLayout` | Public auth pages |
| `HOME_PORTAL` | `HomePortalLayout` trong `ProtectedShell` | `/home` sau login |
| `MODULE_WORKSPACE` | `ModuleWorkspaceLayout` trong `ProtectedShell` | HR, ATT, LEAVE, TASK, DASH, NOTI, SYSTEM |
| `ACCOUNT` | `AccountLayout` trong `ProtectedShell` | Hồ sơ tài khoản, đổi mật khẩu, session |
| `ERROR` | `ErrorLayout` hoặc state trong shell | 403, 404, 500 |

### 7.3 Component tree thực tế

```text
src/
  app/
    layout.tsx
    (public)/
      layout.tsx
      login/page.tsx
      forgot-password/page.tsx
      reset-password/page.tsx
    (protected)/
      layout.tsx
      home/page.tsx
      dashboard/page.tsx
      hr/page.tsx
      attendance/page.tsx
      leave/page.tsx
      tasks/page.tsx
      notifications/page.tsx
      system/page.tsx
      account/page.tsx

  layouts/
    auth/
      AuthLayout.tsx
      AuthPanel.tsx
      AuthBrandPanel.tsx
    protected/
      ProtectedShell.tsx
      ProtectedShellBoundary.tsx
      ProtectedContentRouter.tsx
    home/
      HomePortalLayout.tsx
      HomePortalHeader.tsx
      HomeAppGrid.tsx
      HomeRecentApps.tsx
      HomeQuickAccess.tsx
    workspace/
      ModuleWorkspaceLayout.tsx
      ModuleSidebar.tsx
      ModuleSidebarItem.tsx
      MainContentShell.tsx
      PageHeader.tsx
      PageToolbar.tsx
      Breadcrumbs.tsx
      WorkspaceState.tsx
    topbar/
      GlobalTopbar.tsx
      CurrentAppIndicator.tsx
      GlobalSearch.tsx
      NotificationBadgeButton.tsx
      AvatarMenu.tsx
    app-switcher/
      AppSwitcher.tsx
      AppSwitcherOverlay.tsx
      AppSwitcherSearch.tsx
      AppSwitcherGrid.tsx
      AppSwitcherItem.tsx
    account/
      AccountLayout.tsx

  stores/
    layout.store.ts

  hooks/
    useCurrentRouteMeta.ts
    useCurrentModule.ts
    useWorkspaceSidebar.ts
    useLayoutPermissions.ts
    useDirtyFormGuard.ts
```

---

## 8. Data dependencies của layout

### 8.1 Layout-level queries

| Query | Mục đích | Nơi dùng |
| --- | --- | --- |
| `useAuthMe()` | Lấy user, company, employee, permissions, modules | ProtectedShell |
| `useMyApps()` | Lấy app/module user được thấy | HomePortal, AppSwitcher |
| `useRecentApps()` | Lấy app mở gần đây | HomePortal, AppSwitcher |
| `useFavoriteApps()` | Lấy app ghim/yêu thích | HomePortal, AppSwitcher |
| `useNotificationUnreadCount()` | Badge thông báo | GlobalTopbar, Sidebar nếu cần |
| `useSidebarBadgeCounts(moduleCode)` | Badge/counter menu module | ModuleSidebar |
| `useCompanyUiSettings()` | Theme/logo/tên công ty nếu có | Topbar, HomePortal |

### 8.2 Endpoint đề xuất

```http
GET /api/v1/auth/me
GET /api/v1/foundation/modules/my-apps
GET /api/v1/foundation/modules/recent-apps
GET /api/v1/foundation/modules/favorite-apps
POST /api/v1/foundation/modules/{module_code}/open
POST /api/v1/foundation/modules/{module_code}/favorite
DELETE /api/v1/foundation/modules/{module_code}/favorite
GET /api/v1/notifications/unread-count
GET /api/v1/foundation/layout/sidebar-badges?module=HR
```

Nếu backend chưa có endpoint app registry, frontend có thể dùng local registry theo permission trong giai đoạn mock. Tuy nhiên về lâu dài, backend nên trả danh sách app theo quyền, trạng thái module và company setting.

### 8.3 Query behavior

| Query | `staleTime` đề xuất | Lưu ý |
| --- | --- | --- |
| `auth.me` | 1 - 5 phút | Refetch khi focus nếu cần bảo mật cao |
| `myApps` | 5 - 15 phút | Invalidate khi quyền/module setting đổi |
| `recentApps` | 1 - 5 phút | Invalidate sau khi mở app |
| `favoriteApps` | 5 - 15 phút | Invalidate sau favorite/unfavorite |
| `notificationUnreadCount` | 30 - 60 giây | Có thể realtime phase sau |
| `sidebarBadgeCounts` | 30 - 120 giây | Theo module, scope và permission |

---

## 9. Layout state store

### 9.1 State cần quản lý

| State | Kiểu | Persist | Ghi chú |
| --- | --- | --- | --- |
| `isSidebarCollapsed` | boolean | Có, theo user/device | Không nhạy cảm |
| `isMobileSidebarOpen` | boolean | Không | Reset khi đổi route |
| `isAppSwitcherOpen` | boolean | Không | Overlay toàn hệ thống |
| `topbarSearchOpen` | boolean | Không | Mobile/tablet |
| `activeModalKey` | string/null | Không | Tùy global modal |
| `dirtyFormState` | object/null | Không | Guard đổi route/app |
| `lastOpenedModule` | ModuleCode/null | Có thể | Không chứa dữ liệu nhạy cảm |

### 9.2 Zustand store đề xuất

```ts
// src/stores/layout.store.ts
import { create } from 'zustand';

export interface DirtyFormState {
  routeKey: string;
  message?: string;
}

interface LayoutState {
  isSidebarCollapsed: boolean;
  isMobileSidebarOpen: boolean;
  isAppSwitcherOpen: boolean;
  topbarSearchOpen: boolean;
  dirtyFormState: DirtyFormState | null;

  setSidebarCollapsed: (value: boolean) => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  openAppSwitcher: () => void;
  closeAppSwitcher: () => void;
  toggleAppSwitcher: () => void;
  setTopbarSearchOpen: (value: boolean) => void;
  setDirtyFormState: (state: DirtyFormState | null) => void;
  resetTransientLayoutState: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  isSidebarCollapsed: false,
  isMobileSidebarOpen: false,
  isAppSwitcherOpen: false,
  topbarSearchOpen: false,
  dirtyFormState: null,

  setSidebarCollapsed: (value) => set({ isSidebarCollapsed: value }),
  openMobileSidebar: () => set({ isMobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),
  openAppSwitcher: () => set({ isAppSwitcherOpen: true }),
  closeAppSwitcher: () => set({ isAppSwitcherOpen: false }),
  toggleAppSwitcher: () =>
    set((state) => ({ isAppSwitcherOpen: !state.isAppSwitcherOpen })),
  setTopbarSearchOpen: (value) => set({ topbarSearchOpen: value }),
  setDirtyFormState: (dirtyFormState) => set({ dirtyFormState }),
  resetTransientLayoutState: () =>
    set({
      isMobileSidebarOpen: false,
      isAppSwitcherOpen: false,
      topbarSearchOpen: false,
    }),
}));
```

### 9.3 Persist rule

Chỉ persist dữ liệu không nhạy cảm:

```text
sidebar collapsed
preferred layout density nếu có
favorite UI preference nếu có
```

Không persist:

```text
token
permission list
employee profile
notification content
sidebar badge response
recent sensitive route params
```

---

## 10. AuthLayout

### 10.1 Mục đích

`AuthLayout` dùng cho các màn public liên quan đến xác thực:

1. Login.
2. Forgot password.
3. Reset password.
4. Invite/first password setup nếu có.

### 10.2 Yêu cầu UX

1. Không hiển thị GlobalTopbar.
2. Không hiển thị App Switcher.
3. Có vùng branding sản phẩm.
4. Có vùng form rõ ràng.
5. Có responsive mobile tốt.
6. Nếu user đã authenticated và vào `/login`, redirect về `/home`.

### 10.3 Component API

```ts
interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  showBrandPanel?: boolean;
}
```

### 10.4 Skeleton code

```tsx
// src/layouts/auth/AuthLayout.tsx
export function AuthLayout({ children, title, subtitle, showBrandPanel = true }: AuthLayoutProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        {showBrandPanel ? <AuthBrandPanel /> : null}

        <section className="flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-md">
            {title ? <h1 className="text-2xl font-semibold">{title}</h1> : null}
            {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
```

### 10.5 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| FE05-AUTH-AC-001 | Login/Forgot/Reset dùng chung AuthLayout |
| FE05-AUTH-AC-002 | AuthLayout không load app registry/sidebar/notification |
| FE05-AUTH-AC-003 | Mobile hiển thị form trước, brand panel có thể ẩn |
| FE05-AUTH-AC-004 | Authenticated user vào `/login` được redirect đúng |

---

## 11. ProtectedShell

### 11.1 Mục đích

`ProtectedShell` là layout gốc cho mọi route yêu cầu đăng nhập.

Nhiệm vụ:

1. Boot session.
2. Kiểm tra user/company/module status.
3. Render GlobalTopbar.
4. Render đúng layout con theo route metadata.
5. Mount AppSwitcher, NotificationDropdown, ToastLayer, ModalLayer.
6. Xử lý loading/401/403/module disabled ở cấp shell.

### 11.2 ProtectedShell flow

```text
Protected route load
  -> useAuthMe()
  -> loading: render ProtectedShellSkeleton
  -> 401: redirect /login?returnUrl=<current>
  -> account locked/company inactive: render AccountBlockedState
  -> success: build permission checker
  -> get current route meta
  -> check route access
  -> if forbidden: render ForbiddenState
  -> else render layout by route meta
```

### 11.3 Skeleton code

```tsx
// src/layouts/protected/ProtectedShell.tsx
export function ProtectedShell({ children }: { children: React.ReactNode }) {
  const sessionQuery = useAuthMe();
  const routeMeta = useCurrentRouteMeta();
  const permission = usePermission();

  if (sessionQuery.isLoading) {
    return <ProtectedShellSkeleton />;
  }

  if (sessionQuery.error) {
    return <ProtectedShellError error={sessionQuery.error} />;
  }

  const routeAccess = canAccessRoute(routeMeta, permission, sessionQuery.data?.modules ?? []);

  if (!routeAccess.allowed) {
    return <ForbiddenState reason={routeAccess.reason} />;
  }

  return (
    <div className="min-h-screen bg-app text-foreground">
      <GlobalTopbar />
      <ProtectedContentRouter routeMeta={routeMeta}>{children}</ProtectedContentRouter>
      <AppSwitcher />
      <GlobalToastLayer />
      <GlobalModalLayer />
    </div>
  );
}
```

### 11.4 Shell states

| State | UI |
| --- | --- |
| Session loading | Full page skeleton topbar + content placeholder |
| Session expired | Redirect login hoặc AuthExpiredState nếu redirect fail |
| Account locked | AccountBlockedState, không render app data |
| Company inactive | CompanyInactiveState |
| Route forbidden | ForbiddenState trong content area |
| Module maintenance | ModuleMaintenanceState |
| Unknown error | ErrorState có retry |

---

## 12. GlobalTopbar

### 12.1 Mục đích

`GlobalTopbar` là thanh điều hướng chung cho toàn bộ protected area.

Topbar giúp user:

1. Về Home Portal.
2. Biết đang ở module nào.
3. Mở App Switcher.
4. Tìm kiếm nếu được bật.
5. Xem thông báo.
6. Mở menu tài khoản.

### 12.2 Desktop anatomy

```text
+--------------------------------------------------------------------------------+
| Logo/Home | Current App | Search...                         Apps | Noti | Avatar |
+--------------------------------------------------------------------------------+
```

### 12.3 Props đề xuất

```ts
interface GlobalTopbarProps {
  currentModule?: AppModuleView | null;
  showSearch?: boolean;
  showNotification?: boolean;
  showAppSwitcher?: boolean;
}
```

### 12.4 Component behavior

| Thành phần | Behavior |
| --- | --- |
| Logo/Home | Click về `/home`, nếu dirty form thì confirm |
| Current App | Hiển thị icon + tên app hiện tại; ở Home Portal hiển thị `Trang chủ` |
| Search | Desktop hiển thị input; mobile hiển thị icon mở search overlay |
| App Switcher button | Mở AppSwitcher overlay/drawer/fullscreen |
| Notification badge | Hiển thị unread count nếu có quyền |
| Avatar menu | Profile, account, change password, logout |

### 12.5 Notification badge rule

1. Chỉ query unread count nếu user có quyền xem notification của mình.
2. Nếu API lỗi, không làm sập topbar; hiển thị badge degraded hoặc ẩn số.
3. Badge không được hiển thị số liệu ngoài phạm vi quyền.
4. Click notification item phải deep link về module gốc.

### 12.6 Skeleton code

```tsx
export function GlobalTopbar() {
  const currentModule = useCurrentModule();
  const { openAppSwitcher, openMobileSidebar } = useLayoutStore();
  const unreadQuery = useNotificationUnreadCount({ enabled: canViewOwnNotification() });

  return (
    <header className="sticky top-0 z-topbar flex h-14 items-center border-b bg-surface px-4">
      <button className="lg:hidden" onClick={openMobileSidebar} aria-label="Mở menu">
        <MenuIcon />
      </button>

      <HomeLogoButton />
      <CurrentAppIndicator app={currentModule} />
      <GlobalSearch />

      <div className="ml-auto flex items-center gap-2">
        <button onClick={openAppSwitcher} aria-label="Mở danh sách ứng dụng">
          <GridIcon />
          <span className="hidden md:inline">Ứng dụng</span>
        </button>
        <NotificationBadgeButton count={unreadQuery.data?.count} />
        <AvatarMenu />
      </div>
    </header>
  );
}
```

---

## 13. HomePortalLayout

### 13.1 Mục đích

`HomePortalLayout` là màn hình đầu tiên sau đăng nhập. Đây là cổng vào hệ thống, không phải dashboard nghiệp vụ chi tiết.

Home Portal hiển thị:

1. Lời chào theo user.
2. Danh sách ứng dụng user được phép truy cập.
3. Recent apps.
4. Favorite apps.
5. Quick access / quick actions nếu có.
6. App locked/coming soon nếu policy cho phép hiển thị.
7. Loading/empty/error state.

### 13.2 Anatomy

```text
ProtectedShell
  -> GlobalTopbar
  -> HomePortalLayout
     -> HomePortalHeader
     -> HomeSearch
     -> FavoriteApps
     -> RecentApps
     -> MyAppsGrid
     -> OtherApps / ComingSoonApps optional
```

### 13.3 Home app card type

```ts
export interface AppModuleView {
  moduleCode: ModuleCode;
  name: string;
  shortName?: string;
  description?: string;
  icon?: React.ComponentType;
  accentColor?: string;
  rootPath: string;
  status: 'active' | 'locked' | 'coming_soon' | 'maintenance' | 'hidden';
  badgeCount?: number;
  badgeVariant?: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  isFavorite?: boolean;
  isRecent?: boolean;
  requiredAnyPermissions?: string[];
  requiredScopes?: DataScope[];
}
```

### 13.4 App click flow

```text
User click app card
  -> Nếu app active và route allowed
     -> POST /foundation/modules/{module_code}/open nếu có API
     -> Navigate rootPath hoặc last opened route
  -> Nếu dirty form ở route hiện tại
     -> Confirm trước khi navigate
  -> Nếu app locked/coming soon
     -> Hiển thị LockedApp/ComingSoon state, không navigate
  -> Nếu app maintenance
     -> Hiển thị Maintenance state
```

### 13.5 Empty states

| Trường hợp | UI |
| --- | --- |
| Không có app nào | EmptyState: `Bạn chưa có ứng dụng nào được cấp quyền.` |
| App registry lỗi | ErrorState có nút thử lại |
| Đang load app | AppCard skeleton grid |
| Có app bị khóa | LockedApp card nếu policy cho phép |
| App coming soon | ComingSoon badge hoặc section riêng |

---

## 14. AppSwitcher

### 14.1 Mục đích

`AppSwitcher` giúp user chuyển nhanh giữa các module từ mọi màn protected.

### 14.2 Responsive behavior

| Breakpoint | UI |
| --- | --- |
| Desktop | Center overlay hoặc popover lớn, có backdrop nhẹ |
| Tablet | Right drawer hoặc centered dialog rộng |
| Mobile | Fullscreen sheet |

### 14.3 Behavior bắt buộc

1. Mở từ nút `Ứng dụng` trên topbar.
2. Đóng bằng ESC, click backdrop hoặc nút close.
3. Focus trap khi mở.
4. Search app theo tên, module code, alias, không dấu nếu có.
5. App không có quyền thì không render, trừ khi policy cho hiển thị locked/coming soon.
6. Khi chọn app khác, kiểm tra dirty form guard.
7. Khi chọn app hiện tại, đóng switcher và giữ route.
8. App Switcher không làm mất route hiện tại phía sau overlay.

### 14.4 Component tree

```text
AppSwitcher
├── AppSwitcherOverlay
│   ├── AppSwitcherHeader
│   ├── AppSwitcherSearch
│   ├── RecentAppsSection
│   ├── FavoriteAppsSection
│   ├── MyAppsSection
│   ├── OtherAppsSection optional
│   └── AppSwitcherFooter optional
```

### 14.5 Keyboard shortcut

Đề xuất:

| Shortcut | Action |
| --- | --- |
| `Ctrl + K` hoặc `Cmd + K` | Mở App Switcher / command palette |
| `Esc` | Đóng App Switcher |
| `ArrowUp/ArrowDown` | Di chuyển kết quả search |
| `Enter` | Mở app đang focus |

### 14.6 Skeleton code

```tsx
export function AppSwitcher() {
  const { isAppSwitcherOpen, closeAppSwitcher } = useLayoutStore();
  const appsQuery = useMyApps({ enabled: isAppSwitcherOpen });

  return (
    <Dialog open={isAppSwitcherOpen} onOpenChange={(open) => !open && closeAppSwitcher()}>
      <DialogContent className="max-w-3xl p-0 sm:rounded-xl">
        <AppSwitcherHeader />
        <AppSwitcherSearch />
        {appsQuery.isLoading ? <AppSwitcherSkeleton /> : null}
        {appsQuery.error ? <AppSwitcherError error={appsQuery.error} /> : null}
        {appsQuery.data ? <AppSwitcherGrid apps={appsQuery.data} /> : null}
      </DialogContent>
    </Dialog>
  );
}
```

---

## 15. ModuleWorkspaceLayout

### 15.1 Mục đích

`ModuleWorkspaceLayout` là layout làm việc chuyên sâu cho một module cụ thể.

Dùng cho:

1. Dashboard.
2. HR.
3. Attendance.
4. Leave.
5. Task.
6. Notification.
7. AUTH Admin/System/Foundation.

### 15.2 Anatomy desktop

```text
+--------------------------------------------------------------------------------+
| GLOBAL TOPBAR                                                                  |
+----------------------------+---------------------------------------------------+
| MODULE SIDEBAR             | MAIN CONTENT SHELL                                |
| Module identity            | Breadcrumb                                        |
| Menu groups                | PageHeader                                        |
| Menu item + badge          | Toolbar                                           |
| Collapse toggle            | PageBody                                          |
+----------------------------+---------------------------------------------------+
```

### 15.3 Props đề xuất

```ts
interface ModuleWorkspaceLayoutProps {
  moduleCode: ModuleCode;
  children: React.ReactNode;
  sidebarItems?: WorkspaceSidebarItem[];
  pageHeader?: PageHeaderConfig;
  toolbar?: React.ReactNode;
  rightPanel?: React.ReactNode;
}

export interface PageHeaderConfig {
  title: string;
  description?: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  statusBadge?: React.ReactNode;
}
```

### 15.4 Implementation flow

```text
ModuleWorkspaceLayout mount
  -> Get current route meta
  -> Resolve module by routeMeta.moduleCode
  -> Check module status: active/locked/maintenance/hidden
  -> Get sidebar registry by moduleCode
  -> Filter sidebar by permission/data scope/feature flag/module status
  -> Load sidebar badges if enabled
  -> Render ModuleSidebar
  -> Render MainContentShell
  -> On mobile: render sidebar as drawer
```

### 15.5 Skeleton code

```tsx
export function ModuleWorkspaceLayout({ moduleCode, children }: ModuleWorkspaceLayoutProps) {
  const routeMeta = useCurrentRouteMeta();
  const module = useModuleAccess(moduleCode);
  const sidebar = useWorkspaceSidebar(moduleCode);
  const { isSidebarCollapsed, isMobileSidebarOpen, closeMobileSidebar } = useLayoutStore();

  if (!module || module.status === 'hidden') {
    return <NotFoundState />;
  }

  if (module.status === 'locked') {
    return <LockedModuleState module={module} />;
  }

  if (module.status === 'maintenance') {
    return <ModuleMaintenanceState module={module} />;
  }

  return (
    <div className="flex min-h-[calc(100vh-var(--topbar-height))]">
      <ModuleSidebar
        module={module}
        items={sidebar.items}
        collapsed={isSidebarCollapsed}
        className="hidden lg:flex"
      />

      <MobileSidebarDrawer open={isMobileSidebarOpen} onClose={closeMobileSidebar}>
        <ModuleSidebar module={module} items={sidebar.items} collapsed={false} />
      </MobileSidebarDrawer>

      <MainContentShell routeMeta={routeMeta}>{children}</MainContentShell>
    </div>
  );
}
```

### 15.6 Module root routes

| Module | Root route | Layout |
| --- | --- | --- |
| DASH | `/dashboard` | ModuleWorkspaceLayout `DASH` |
| HR | `/hr` | ModuleWorkspaceLayout `HR` |
| ATT | `/attendance` | ModuleWorkspaceLayout `ATT` |
| LEAVE | `/leave` | ModuleWorkspaceLayout `LEAVE` |
| TASK | `/tasks` | ModuleWorkspaceLayout `TASK` |
| NOTI | `/notifications` | ModuleWorkspaceLayout `NOTI` |
| AUTH Admin | `/auth-admin` hoặc `/system/users` | ModuleWorkspaceLayout `AUTH/FOUNDATION` |
| SYSTEM | `/system` | ModuleWorkspaceLayout `FOUNDATION` |

---

## 16. ModuleSidebar

### 16.1 Mục đích

`ModuleSidebar` là menu điều hướng riêng của module hiện tại.

### 16.2 Quy tắc render

1. Chỉ render trong Module Workspace.
2. Chỉ chứa menu của module hiện tại.
3. Không hard-code theo role.
4. Menu không có quyền thì ẩn.
5. Menu cha chỉ hiện nếu có ít nhất một menu con được phép.
6. Badge chỉ hiện nếu user có quyền xem dữ liệu tương ứng.
7. Không quá 2 cấp trong MVP.
8. Desktop hỗ trợ expanded/collapsed.
9. Tablet/mobile dùng drawer.

### 16.3 Sidebar item type

```ts
export interface WorkspaceSidebarItem {
  key: string;
  moduleCode: ModuleCode;
  label: string;
  path?: string;
  icon?: React.ComponentType;
  group?: 'overview' | 'operation' | 'management' | 'report' | 'settings' | 'admin';
  parentKey?: string;
  order: number;
  exact?: boolean;
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: DataScope[];
  featureFlag?: string;
  badgeSource?: string;
  badgeVariant?: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  isBeta?: boolean;
  isComingSoon?: boolean;
  children?: WorkspaceSidebarItem[];
}
```

### 16.4 Sidebar group chuẩn

| Group | Dùng cho |
| --- | --- |
| `overview` | Tổng quan module |
| `operation` | Nghiệp vụ chính |
| `management` | Quản lý danh mục/cấu hình nghiệp vụ |
| `report` | Báo cáo/export |
| `settings` | Thiết lập module |
| `admin` | Admin/system functions |

### 16.5 Sidebar state

| State | Behavior |
| --- | --- |
| Expanded | Icon + label + badge + group label |
| Collapsed | Chỉ icon, tooltip label, badge dạng dot hoặc số nhỏ |
| Active | Highlight, `aria-current="page"` |
| Parent active | Nhóm cha mở, cha highlight nhẹ |
| Disabled | Không click, tooltip giải thích |
| Forbidden | Không render |
| Empty | EmptyState trong sidebar |

### 16.6 Example sidebar registry

```ts
export const hrSidebarItems: WorkspaceSidebarItem[] = [
  {
    key: 'hr.overview',
    moduleCode: 'HR',
    label: 'Tổng quan',
    path: '/hr',
    group: 'overview',
    order: 10,
    requiredAnyPermissions: ['HR.EMPLOYEE.VIEW'],
  },
  {
    key: 'hr.employees',
    moduleCode: 'HR',
    label: 'Nhân viên',
    path: '/hr/employees',
    group: 'operation',
    order: 20,
    requiredAnyPermissions: ['HR.EMPLOYEE.VIEW'],
    badgeSource: 'hr.employee.pending_profile_changes',
  },
  {
    key: 'hr.departments',
    moduleCode: 'HR',
    label: 'Phòng ban',
    path: '/hr/departments',
    group: 'management',
    order: 30,
    requiredAnyPermissions: ['HR.DEPARTMENT.VIEW'],
  },
];
```

---

## 17. MainContentShell

### 17.1 Mục đích

`MainContentShell` là vùng nội dung chính bên phải sidebar.

Nó chuẩn hóa:

1. Breadcrumb.
2. PageHeader.
3. Action group.
4. Toolbar.
5. Alert/context notice.
6. Page body.
7. Right drawer/modal slot.
8. State handling.

### 17.2 Anatomy

```text
MainContentShell
├── Breadcrumbs
├── PageHeader
│   ├── Title
│   ├── Description
│   ├── PrimaryAction
│   └── SecondaryActions
├── PageToolbar optional
├── ContextualAlert optional
└── PageBody
```

### 17.3 Props đề xuất

```ts
interface MainContentShellProps {
  routeMeta: RouteMeta;
  children: React.ReactNode;
  header?: PageHeaderConfig;
  toolbar?: React.ReactNode;
  contextualAlert?: React.ReactNode;
  maxWidth?: 'full' | 'content' | 'narrow';
  density?: 'comfortable' | 'compact';
}
```

### 17.4 Max width rule

| Template | Max width |
| --- | --- |
| Overview | `full` |
| List/Table | `full` |
| Detail | `content` hoặc `full` nếu nhiều tab |
| Form | `narrow` hoặc `content` |
| Approval | `content` |
| Kanban | `full` |
| Calendar | `full` |
| Settings | `content` |
| Audit log | `full` |

### 17.5 PageHeader action rule

1. Primary action chỉ hiện nếu user có quyền.
2. Nếu thiếu business state, action có thể disable kèm tooltip.
3. Secondary action như export/import/refresh nằm trong action group hoặc more menu.
4. Mobile chỉ giữ primary action quan trọng, các action khác vào overflow menu.

---

## 18. Page template foundation

FRONTEND-05 chỉ tạo template shell, chưa implement nghiệp vụ chi tiết.

### 18.1 OverviewPageShell

Dùng cho trang tổng quan module.

```tsx
<OverviewPageShell
  title="Tổng quan nhân sự"
  metrics={<MetricGrid />}
  main={<MainWidget />}
  side={<QuickActionPanel />}
/>
```

### 18.2 ListPageShell

Dùng cho danh sách/table.

```tsx
<ListPageShell
  title="Danh sách nhân viên"
  actions={<CreateEmployeeButton />}
  toolbar={<EmployeeFilterBar />}
>
  <EmployeeDataTable />
</ListPageShell>
```

### 18.3 DetailPageShell

Dùng cho chi tiết entity.

```tsx
<DetailPageShell
  title="Hồ sơ nhân viên"
  statusBadge={<EmployeeStatusBadge />}
  tabs={<EmployeeDetailTabs />}
>
  <EmployeeProfileDetail />
</DetailPageShell>
```

### 18.4 FormPageShell

Dùng cho form dài.

```tsx
<FormPageShell
  title="Thêm nhân viên"
  footer={<FormFooterActions />}
>
  <EmployeeForm />
</FormPageShell>
```

### 18.5 KanbanPageShell

Dùng cho Task Kanban.

```tsx
<KanbanPageShell
  title="Kanban công việc"
  toolbar={<TaskBoardToolbar />}
>
  <TaskKanbanBoard />
</KanbanPageShell>
```

---

## 19. Permission và module status trong layout

### 19.1 Module status

| Status | Home Portal | App Switcher | Module Workspace |
| --- | --- | --- | --- |
| `active` | Hiển thị mở được | Hiển thị mở được | Render bình thường |
| `locked` | Ẩn hoặc card khóa | Ẩn hoặc item khóa | LockedModuleState |
| `coming_soon` | Card coming soon nếu policy cho phép | Item disabled | ComingSoonState |
| `maintenance` | Badge maintenance | Disabled | ModuleMaintenanceState |
| `hidden` | Không hiển thị | Không hiển thị | 404/NotFound |

### 19.2 Permission check ở layout

| Thành phần | Check theo |
| --- | --- |
| App card | Module access + route root permission |
| Sidebar item | `requiredPermissions`, `requiredAnyPermissions`, `requiredScopes`, feature flag |
| Primary action | Action registry + allowed action từ API nếu có |
| Field nhạy cảm | Field permission hoặc backend masked field |
| Badge/counter | Permission riêng của dữ liệu badge |
| Notification badge | `NOTI.NOTIFICATION.VIEW_OWN` hoặc permission tương đương |

### 19.3 Empty due to scope

Nếu user có quyền vào màn nhưng data scope không có dữ liệu, UI không hiển thị forbidden mà hiển thị empty state:

```text
Không có dữ liệu trong phạm vi bạn được phân quyền.
```

Forbidden chỉ dùng khi user không có quyền vào route/action.

---

## 20. Dirty form guard

### 20.1 Khi nào cần guard

Dirty form guard cần chạy khi user:

1. Bấm Home.
2. Mở app khác từ App Switcher.
3. Bấm sidebar route khác.
4. Back/forward browser nếu có thể intercept.
5. Logout.

### 20.2 Hook đề xuất

```ts
export function useDirtyFormGuard(input: { isDirty: boolean; message?: string }) {
  const { setDirtyFormState } = useLayoutStore();
  const routeMeta = useCurrentRouteMeta();

  useEffect(() => {
    if (!input.isDirty) {
      setDirtyFormState(null);
      return;
    }

    setDirtyFormState({
      routeKey: routeMeta.routeKey,
      message: input.message ?? 'Bạn có thay đổi chưa lưu. Bạn có chắc muốn rời trang?',
    });

    return () => setDirtyFormState(null);
  }, [input.isDirty, input.message, routeMeta.routeKey, setDirtyFormState]);
}
```

### 20.3 Confirm behavior

| Action | Nếu dirty |
| --- | --- |
| Navigate sidebar | Hiển thị confirm |
| Open app khác | Hiển thị confirm trước khi chuyển app |
| Close App Switcher | Không cần confirm |
| Logout | Confirm mạnh hơn: thay đổi chưa lưu sẽ mất |
| Browser refresh | `beforeunload` nếu form đang dirty |

---

## 21. Responsive implementation

### 21.1 Breakpoints đề xuất

| Breakpoint | Width | Behavior |
| --- | --- | --- |
| Mobile | `< 768px` | Sidebar drawer, AppSwitcher fullscreen, table có thể chuyển card/list |
| Tablet | `768px - 1023px` | Sidebar collapsed/drawer, topbar search icon |
| Desktop | `>= 1024px` | Sidebar fixed, topbar full, content 12-col |
| Wide desktop | `>= 1440px` | Content rộng, drawer/table tối ưu |

### 21.2 Desktop layout

1. Topbar sticky top.
2. Sidebar fixed trong workspace height còn lại.
3. Main content scroll riêng hoặc page scroll tùy màn.
4. Page toolbar sticky optional với table lớn.

### 21.3 Tablet layout

1. Sidebar mặc định collapsed hoặc drawer.
2. Topbar search thu gọn.
3. PageHeader action chuyển vào overflow nếu nhiều.
4. Drawer detail rộng 70% - 85%.

### 21.4 Mobile web layout

1. Topbar chỉ giữ Home, app name rút gọn, Apps, Noti, Avatar/Menu.
2. Sidebar mở bằng menu icon dạng drawer/fullscreen.
3. PageHeader gọn: title + primary action.
4. Filter mở bằng drawer.
5. Table nghiệp vụ quan trọng có thể chuyển thành card list ở module sau.
6. Drawer và modal gần fullscreen.

---

## 22. Accessibility

### 22.1 Landmark

Layout cần dùng semantic landmark:

```text
<header> GlobalTopbar
<nav> ModuleSidebar / AppSwitcher nav
<main> MainContentShell
<aside> RightPanel nếu có
```

### 22.2 Keyboard

| Thành phần | Yêu cầu |
| --- | --- |
| Topbar buttons | Focus visible, aria-label |
| AppSwitcher | Focus trap, ESC close, arrow navigation nếu search list |
| Sidebar | Tab được, active item có `aria-current="page"` |
| Dropdown/avatar | ESC close, click outside close |
| Modal/drawer | Focus trap, restore focus khi đóng |
| Skip link | Có link bỏ qua navigation tới main content |

### 22.3 ARIA label

Các nút icon-only cần aria-label:

```tsx
<button aria-label="Mở danh sách ứng dụng">
  <GridIcon />
</button>
```

---

## 23. Error và state mapping trong layout

### 23.1 Layout-level error

| Error | Nơi xảy ra | UI |
| --- | --- | --- |
| 401 | ProtectedShell/session | Redirect login hoặc AuthExpiredState |
| 403 | Route guard/module guard | ForbiddenState |
| 404 route | Route not found | NotFoundState |
| Module hidden | Module access | NotFoundState hoặc LockedApp tùy policy |
| Module maintenance | Module status | ModuleMaintenanceState |
| App registry lỗi | Home/AppSwitcher | ErrorState cục bộ, không logout |
| Notification unread lỗi | Topbar | Ẩn badge hoặc degraded badge |
| Sidebar badge lỗi | Sidebar | Ẩn badge, không làm sập sidebar |
| Network offline | Shell/query | Offline banner + retry |

### 23.2 State component cần có

1. `ProtectedShellSkeleton`.
2. `HomePortalSkeleton`.
3. `AppSwitcherSkeleton`.
4. `WorkspaceSkeleton`.
5. `ForbiddenState`.
6. `NotFoundState`.
7. `LockedModuleState`.
8. `ModuleMaintenanceState`.
9. `OfflineBanner`.
10. `StaleDataBanner`.

---

## 24. Performance guideline

### 24.1 Không load tất cả dữ liệu nghiệp vụ ở layout

Layout chỉ load dữ liệu cần cho shell:

```text
session
my apps
unread count
sidebar badges nhẹ
company UI settings
```

Không load:

```text
employee list
attendance records
leave requests
task board
audit log
```

### 24.2 Lazy load

1. AppSwitcher chỉ query app detail/recent/favorite khi mở nếu chưa có cache.
2. Notification dropdown chỉ query danh sách notification khi mở dropdown.
3. Sidebar badge có thể lazy theo module hiện tại.
4. Module-specific heavy widgets để module page tự load.

### 24.3 Memoization

1. Filter sidebar theo permission cần memoize theo `moduleCode + permissionVersion + route`.
2. App registry visible list memoize theo `permissions + modules + featureFlags`.
3. Avoid rerender toàn bộ shell khi notification count polling.

### 24.4 Code splitting

1. AppSwitcher có thể lazy import nếu bundle lớn.
2. Module sidebar icons nên dùng icon tree-shaking.
3. Module pages tự code split theo Next.js route.

---

## 25. Folder structure chi tiết

```text
src/
  layouts/
    auth/
      AuthLayout.tsx
      AuthBrandPanel.tsx
      AuthPanel.tsx
      index.ts

    protected/
      ProtectedShell.tsx
      ProtectedShellSkeleton.tsx
      ProtectedShellError.tsx
      ProtectedContentRouter.tsx
      index.ts

    topbar/
      GlobalTopbar.tsx
      HomeLogoButton.tsx
      CurrentAppIndicator.tsx
      GlobalSearch.tsx
      NotificationBadgeButton.tsx
      AvatarMenu.tsx
      index.ts

    home/
      HomePortalLayout.tsx
      HomePortalHeader.tsx
      HomeAppGrid.tsx
      HomeAppCard.tsx
      HomeRecentApps.tsx
      HomeFavoriteApps.tsx
      HomeQuickAccess.tsx
      index.ts

    app-switcher/
      AppSwitcher.tsx
      AppSwitcherOverlay.tsx
      AppSwitcherSearch.tsx
      AppSwitcherGrid.tsx
      AppSwitcherItem.tsx
      AppSwitcherState.tsx
      index.ts

    workspace/
      ModuleWorkspaceLayout.tsx
      ModuleSidebar.tsx
      ModuleSidebarGroup.tsx
      ModuleSidebarItem.tsx
      MainContentShell.tsx
      PageHeader.tsx
      PageToolbar.tsx
      Breadcrumbs.tsx
      WorkspaceState.tsx
      MobileSidebarDrawer.tsx
      index.ts

    account/
      AccountLayout.tsx
      AccountSidebar.tsx
      index.ts

  registries/
    app-registry.ts
    sidebar-registry.ts
    layout-registry.ts

  stores/
    layout.store.ts

  hooks/
    layout/
      useCurrentRouteMeta.ts
      useCurrentModule.ts
      useLayoutNavigation.ts
      useWorkspaceSidebar.ts
      useDirtyFormGuard.ts
      useAppSwitcher.ts
      useSidebarBadges.ts

  modules/
    foundation/
      services/
        foundation.api.ts
        foundation.keys.ts
      hooks/
        useMyApps.ts
        useRecentApps.ts
        useFavoriteApps.ts
        useOpenApp.ts

    notifications/
      hooks/
        useNotificationUnreadCount.ts
        useNotificationDropdown.ts
```

---

## 26. Route integration với Next.js App Router

### 26.1 Root layout

```tsx
// src/app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
```

### 26.2 Public layout

```tsx
// src/app/(public)/layout.tsx
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

### 26.3 Protected layout

```tsx
// src/app/(protected)/layout.tsx
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedShell>{children}</ProtectedShell>;
}
```

### 26.4 Module page usage

```tsx
// src/app/(protected)/hr/employees/page.tsx
export default function EmployeeListRoute() {
  return (
    <ModuleWorkspaceLayout moduleCode="HR">
      <EmployeeListPage />
    </ModuleWorkspaceLayout>
  );
}
```

Nếu muốn tránh lặp `ModuleWorkspaceLayout` ở từng page, có thể dùng route group layout theo module:

```text
src/app/(protected)/hr/layout.tsx
src/app/(protected)/hr/employees/page.tsx
```

```tsx
// src/app/(protected)/hr/layout.tsx
export default function HrLayout({ children }: { children: React.ReactNode }) {
  return <ModuleWorkspaceLayout moduleCode="HR">{children}</ModuleWorkspaceLayout>;
}
```

Khuyến nghị dùng route group layout theo module để giảm lặp code.

---

## 27. App registry integration

### 27.1 Local fallback registry

Trong khi backend app registry chưa sẵn, frontend có thể có fallback registry:

```ts
export const appRegistry: AppModuleView[] = [
  {
    moduleCode: 'DASH',
    name: 'Dashboard',
    description: 'Tổng quan công việc và dữ liệu quan trọng',
    rootPath: '/dashboard',
    status: 'active',
    requiredAnyPermissions: ['DASH.DASHBOARD.VIEW'],
  },
  {
    moduleCode: 'HR',
    name: 'Nhân sự',
    description: 'Quản lý hồ sơ nhân viên và cơ cấu tổ chức',
    rootPath: '/hr',
    status: 'active',
    requiredAnyPermissions: ['HR.EMPLOYEE.VIEW'],
  },
  {
    moduleCode: 'ATT',
    name: 'Chấm công',
    description: 'Check-in/out, bảng công, ca làm và điều chỉnh công',
    rootPath: '/attendance',
    status: 'active',
    requiredAnyPermissions: ['ATT.ATTENDANCE.VIEW_OWN', 'ATT.ATTENDANCE.VIEW_TEAM'],
  },
  {
    moduleCode: 'LEAVE',
    name: 'Nghỉ phép',
    description: 'Tạo đơn nghỉ, duyệt nghỉ, lịch nghỉ và số dư phép',
    rootPath: '/leave',
    status: 'active',
    requiredAnyPermissions: ['LEAVE.REQUEST.CREATE', 'LEAVE.REQUEST.VIEW_OWN'],
  },
  {
    moduleCode: 'TASK',
    name: 'Công việc',
    description: 'Dự án, task, Kanban, bình luận và checklist',
    rootPath: '/tasks',
    status: 'active',
    requiredAnyPermissions: ['TASK.TASK.VIEW', 'TASK.PROJECT.VIEW'],
  },
  {
    moduleCode: 'NOTI',
    name: 'Thông báo',
    description: 'Thông báo hệ thống và lịch sử thông báo',
    rootPath: '/notifications',
    status: 'active',
    requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_OWN'],
  },
  {
    moduleCode: 'FOUNDATION',
    name: 'Hệ thống',
    description: 'Cấu hình công ty, module, audit và file',
    rootPath: '/system',
    status: 'active',
    requiredAnyPermissions: ['FOUNDATION.SETTING.VIEW', 'FOUNDATION.AUDIT_LOG.VIEW'],
  },
];
```

### 27.2 Merge backend app access với local metadata

```ts
export function mergeAppAccess(
  localApps: AppModuleView[],
  moduleAccess: ModuleAccessItem[],
): AppModuleView[] {
  const accessMap = new Map(moduleAccess.map((item) => [item.moduleCode, item]));

  return localApps.map((app) => {
    const access = accessMap.get(app.moduleCode);
    return {
      ...app,
      status: access?.status ?? 'hidden',
      featureFlags: access?.featureFlags,
    };
  });
}
```

---

## 28. Sidebar registry integration

### 28.1 Sidebar registry map

```ts
export const sidebarRegistry: Record<ModuleCode, WorkspaceSidebarItem[]> = {
  DASH: dashSidebarItems,
  HR: hrSidebarItems,
  ATT: attendanceSidebarItems,
  LEAVE: leaveSidebarItems,
  TASK: taskSidebarItems,
  NOTI: notificationSidebarItems,
  AUTH: authAdminSidebarItems,
  FOUNDATION: systemSidebarItems,
  PAYROLL: [],
  RECRUIT: [],
  ASSET: [],
  ROOM: [],
  CHAT: [],
  SOCIAL: [],
  AI: [],
};
```

### 28.2 Filter sidebar items

```ts
export function filterSidebarItems(
  items: WorkspaceSidebarItem[],
  permission: PermissionChecker,
  moduleAccess: ModuleAccessItem | null,
): WorkspaceSidebarItem[] {
  if (!moduleAccess || moduleAccess.status !== 'active') return [];

  return items
    .filter((item) => {
      if (item.featureFlag && !moduleAccess.featureFlags?.[item.featureFlag]) return false;

      return permission.checkRequirement({
        requiredPermissions: item.requiredPermissions,
        requiredAnyPermissions: item.requiredAnyPermissions,
        requiredScopes: item.requiredScopes,
      }).allowed;
    })
    .map((item) => ({
      ...item,
      children: item.children
        ? filterSidebarItems(item.children, permission, moduleAccess)
        : undefined,
    }))
    .filter((item) => !item.children || item.children.length > 0)
    .sort((a, b) => a.order - b.order);
}
```

---

## 29. Layout-level notification integration

### 29.1 Topbar unread count

```tsx
function NotificationBadgeButton() {
  const permission = usePermission();
  const canView = permission.can('NOTI.NOTIFICATION.VIEW_OWN');
  const unreadQuery = useNotificationUnreadCount({ enabled: canView });

  if (!canView) return null;

  return (
    <button aria-label="Mở thông báo" className="relative">
      <BellIcon />
      {unreadQuery.data?.count ? (
        <Badge className="absolute -right-1 -top-1">{formatBadgeCount(unreadQuery.data.count)}</Badge>
      ) : null}
    </button>
  );
}
```

### 29.2 Dropdown lazy load

Danh sách notification không nên load ngay khi app mount.

```text
Topbar mount
  -> query unread count nhẹ
User click notification button
  -> query latest notifications
  -> render dropdown
```

---

## 30. Security guideline cho layout

1. Không render dữ liệu nhạy cảm trong topbar/avatar nếu chưa cần.
2. Không log full session object ở console.
3. Không persist permission/user profile nhạy cảm trong localStorage.
4. App Switcher không hiển thị app hidden/không có quyền.
5. Sidebar badge không được leak số liệu ngoài scope.
6. Deep link từ notification không bypass route guard.
7. Logout phải clear layout state có thể chứa context route/user.
8. Nếu đổi user trên cùng browser, phải clear cache layout của user trước.
9. Không dùng `company_id`, `user_id`, `employee_id` từ frontend để lọc dữ liệu layout nếu backend resolve được.

---

## 31. Testing strategy

### 31.1 Unit test

| Nhóm | Test |
| --- | --- |
| `filterSidebarItems` | Ẩn item thiếu permission, thiếu scope, module disabled |
| `mergeAppAccess` | Merge status backend đúng, hidden nếu không có access |
| `layout.store` | Open/close app switcher, sidebar collapsed, reset transient state |
| `useDirtyFormGuard` | Set/clear dirty state đúng |
| Badge formatter | Count lớn hiển thị `99+` hoặc rule thống nhất |

### 31.2 Component test

| Component | Test |
| --- | --- |
| GlobalTopbar | Hiển thị current app, app switcher button, avatar |
| HomePortalLayout | Loading, empty, error, app card render theo permission |
| AppSwitcher | Open/close, search, keyboard ESC, click app |
| ModuleSidebar | Active route, collapsed state, forbidden item không render |
| ModuleWorkspaceLayout | Module locked/maintenance/active states |
| MainContentShell | Breadcrumb, title, action, toolbar render đúng |

### 31.3 E2E smoke test

| Flow | Kỳ vọng |
| --- | --- |
| Login -> Home | Sau login vào `/home`, topbar xuất hiện |
| Home -> HR | Click app HR vào `/hr`, sidebar HR xuất hiện |
| HR -> App Switcher -> Leave | Mở switcher, chọn Leave, vào `/leave` |
| Direct forbidden route | Vào route thiếu quyền hiển thị ForbiddenState |
| Sidebar collapsed | Collapse sidebar, reload vẫn giữ nếu persist bật |
| Notification deep link | Click notification -> route module gốc, guard vẫn chạy |
| Dirty form | Form dirty, click app khác -> confirm |
| Logout | Clear shell/query cache, về login |

---

## 32. Implementation plan theo sprint

### Sprint FE05.1 - Layout foundation

1. Tạo folder `layouts/*`.
2. Tạo `layout.store.ts`.
3. Tạo `AuthLayout`.
4. Tạo `ProtectedShell` skeleton.
5. Tạo `GlobalTopbar` basic.
6. Tạo `MainContentShell` basic.
7. Gắn với Next.js route layout.

### Sprint FE05.2 - Home Portal + App Switcher shell

1. Tạo `HomePortalLayout`.
2. Tạo `HomeAppCard`, `HomeAppGrid`, `RecentApps`, `FavoriteApps`.
3. Tạo `AppSwitcher` overlay desktop.
4. Tạo AppSwitcher responsive tablet/mobile.
5. Tạo app search.
6. Tích hợp `useMyApps`, local fallback registry.

### Sprint FE05.3 - Module Workspace + Sidebar

1. Tạo `ModuleWorkspaceLayout`.
2. Tạo `ModuleSidebar` expanded/collapsed.
3. Tạo mobile sidebar drawer.
4. Tạo sidebar registry theo module.
5. Filter menu theo permission/scope/module status.
6. Tích hợp active route và breadcrumb.

### Sprint FE05.4 - State, permission, badge, error

1. Tích hợp notification unread count ở topbar.
2. Tích hợp sidebar badge counts nếu API/mock có.
3. Tạo LockedModuleState, MaintenanceState, ForbiddenState integration.
4. Tạo DirtyFormGuard.
5. Tạo Offline/Stale banner nếu cần.
6. Kiểm tra logout clear layout state/cache.

### Sprint FE05.5 - Responsive, accessibility, test

1. Desktop/tablet/mobile polish.
2. Focus trap AppSwitcher/mobile sidebar.
3. Keyboard shortcut `Ctrl/Cmd + K`.
4. Unit test layout utilities.
5. Component test layout shell.
6. E2E smoke test các flow chính.
7. Storybook stories cho layout components nếu Storybook bật.

---

## 33. File skeleton cần tạo

```text
src/layouts/auth/AuthLayout.tsx
src/layouts/auth/AuthBrandPanel.tsx
src/layouts/auth/index.ts

src/layouts/protected/ProtectedShell.tsx
src/layouts/protected/ProtectedShellSkeleton.tsx
src/layouts/protected/ProtectedShellError.tsx
src/layouts/protected/ProtectedContentRouter.tsx
src/layouts/protected/index.ts

src/layouts/topbar/GlobalTopbar.tsx
src/layouts/topbar/HomeLogoButton.tsx
src/layouts/topbar/CurrentAppIndicator.tsx
src/layouts/topbar/GlobalSearch.tsx
src/layouts/topbar/NotificationBadgeButton.tsx
src/layouts/topbar/AvatarMenu.tsx
src/layouts/topbar/index.ts

src/layouts/home/HomePortalLayout.tsx
src/layouts/home/HomePortalHeader.tsx
src/layouts/home/HomeAppGrid.tsx
src/layouts/home/HomeAppCard.tsx
src/layouts/home/HomeRecentApps.tsx
src/layouts/home/HomeFavoriteApps.tsx
src/layouts/home/index.ts

src/layouts/app-switcher/AppSwitcher.tsx
src/layouts/app-switcher/AppSwitcherSearch.tsx
src/layouts/app-switcher/AppSwitcherGrid.tsx
src/layouts/app-switcher/AppSwitcherItem.tsx
src/layouts/app-switcher/AppSwitcherState.tsx
src/layouts/app-switcher/index.ts

src/layouts/workspace/ModuleWorkspaceLayout.tsx
src/layouts/workspace/ModuleSidebar.tsx
src/layouts/workspace/ModuleSidebarGroup.tsx
src/layouts/workspace/ModuleSidebarItem.tsx
src/layouts/workspace/MobileSidebarDrawer.tsx
src/layouts/workspace/MainContentShell.tsx
src/layouts/workspace/PageHeader.tsx
src/layouts/workspace/PageToolbar.tsx
src/layouts/workspace/Breadcrumbs.tsx
src/layouts/workspace/WorkspaceState.tsx
src/layouts/workspace/index.ts

src/stores/layout.store.ts

src/registries/app-registry.ts
src/registries/sidebar-registry.ts
src/registries/layout-registry.ts

src/hooks/layout/useCurrentModule.ts
src/hooks/layout/useLayoutNavigation.ts
src/hooks/layout/useWorkspaceSidebar.ts
src/hooks/layout/useDirtyFormGuard.ts
src/hooks/layout/useAppSwitcherShortcut.ts
```

---

## 34. Storybook đề xuất

Nếu Storybook được bật trong MVP, cần tạo stories:

```text
Layout/AuthLayout.stories.tsx
Layout/ProtectedShell.stories.tsx
Layout/GlobalTopbar.stories.tsx
Layout/HomePortalLayout.stories.tsx
Layout/AppSwitcher.stories.tsx
Layout/ModuleWorkspaceLayout.stories.tsx
Layout/ModuleSidebar.stories.tsx
Layout/MainContentShell.stories.tsx
```

Mỗi story nên có state:

1. Default.
2. Loading.
3. Empty.
4. Error.
5. Forbidden.
6. Locked/maintenance.
7. Mobile.
8. Collapsed sidebar.
9. Long menu/long app name.
10. Badge overflow.

---

## 35. Acceptance criteria

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| FE05-AC-001 | Có `AuthLayout` dùng cho login/forgot/reset, không render protected shell |
| FE05-AC-002 | Có `ProtectedShell` boot session, render topbar và state loading/error/forbidden |
| FE05-AC-003 | Có `GlobalTopbar` dùng chung cho mọi protected route |
| FE05-AC-004 | Topbar có Home, current app, App Switcher button, Notification badge, Avatar menu |
| FE05-AC-005 | Có `HomePortalLayout` hiển thị app grid, recent/favorite app và state đầy đủ |
| FE05-AC-006 | Có `AppSwitcher` mở được từ mọi màn protected, hỗ trợ search và responsive |
| FE05-AC-007 | Có `ModuleWorkspaceLayout` dùng chung cho DASH, HR, ATT, LEAVE, TASK, NOTI, SYSTEM |
| FE05-AC-008 | Có `ModuleSidebar` theo module, filter theo permission/data scope/module status |
| FE05-AC-009 | Sidebar hỗ trợ expanded/collapsed desktop và drawer mobile |
| FE05-AC-010 | Có `MainContentShell`, `PageHeader`, `Breadcrumb`, `PageToolbar` reusable |
| FE05-AC-011 | App/Menu/Badge không hard-code theo role name |
| FE05-AC-012 | Layout không tự gọi `fetch`; mọi API đi qua query/API layer chung |
| FE05-AC-013 | Notification unread count lỗi không làm sập topbar |
| FE05-AC-014 | App registry lỗi không làm logout user, chỉ hiển thị error cục bộ |
| FE05-AC-015 | Dirty form guard hoạt động khi chuyển app/sidebar/logout |
| FE05-AC-016 | Logout clear layout state và sensitive query cache |
| FE05-AC-017 | Layout responsive desktop/tablet/mobile web đạt mức dùng được cho P0/P1 |
| FE05-AC-018 | Có keyboard/focus behavior tối thiểu cho App Switcher, Sidebar, Dropdown |
| FE05-AC-019 | Có unit test cho filter menu, app access, layout store |
| FE05-AC-020 | Có E2E smoke test Login -> Home -> Module -> App Switcher -> Logout |

---

## 36. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Layout chứa quá nhiều business logic | Khó bảo trì, trùng module logic | Layout chỉ xử lý shell/navigation/state |
| Hard-code role trong menu | Sai khi role được tùy chỉnh | Dùng permission/data scope từ session/registry |
| Sidebar badge leak dữ liệu | Rò rỉ số liệu ngoài scope | Badge API phải filter backend; FE chỉ hiển thị dữ liệu được trả |
| AppSwitcher query quá nặng | Chậm khi mở | Cache `myApps`, lazy recent/favorite, skeleton |
| Topbar rerender liên tục do unread polling | Giật UI | Tách component badge, memo topbar |
| Mobile layout làm sau | Vỡ trải nghiệm P0 | Thiết kế mobile drawer/fullscreen ngay trong FE05 |
| Dirty form guard thiếu | User mất dữ liệu form | Dùng hook chung cho form pages |
| Module route lặp layout | Code trùng | Dùng route group layout theo module |
| Backend app registry chưa sẵn | FE bị chờ | Dùng local fallback registry + MSW |
| Permission frontend/backend lệch | Hiển thị sai UI | QA matrix route/menu/action theo permission |

---

## 37. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE05-OQ-001 | Backend có endpoint `my-apps/recent-apps/favorite-apps` trong MVP không? | BE/FE | Cao |
| FE05-OQ-002 | Sidebar badge dùng endpoint chung hay từng module tự cung cấp? | BE/FE | Cao |
| FE05-OQ-003 | App Switcher hiển thị app locked/coming soon hay ẩn hoàn toàn? | Product/UI | Trung bình |
| FE05-OQ-004 | Có dùng command palette chung với global search không? | FE/Product | Trung bình |
| FE05-OQ-005 | Sidebar collapsed có persist theo user/device không? | FE/Product | Thấp |
| FE05-OQ-006 | Mobile web ưu tiên table card list ở FE05 hay để module xử lý sau? | UI/FE | Trung bình |
| FE05-OQ-007 | Notification dropdown triển khai trong FE05 hay chỉ badge, dropdown sang FE12? | FE/Product | Trung bình |
| FE05-OQ-008 | App last opened route có lưu backend hay local preference? | BE/FE | Thấp |

---

## 38. Definition of Done cho FRONTEND-05

FRONTEND-05 được xem là hoàn thành khi:

1. Toàn bộ route protected chạy trong `ProtectedShell`.
2. User login xong vào được `/home` với `HomePortalLayout`.
3. User mở được module từ Home Portal.
4. User mở được App Switcher từ mọi màn protected.
5. Module Workspace có topbar chung, sidebar module và main content shell.
6. Sidebar được render từ registry và filter theo permission/data scope.
7. Các state loading, empty, error, forbidden, locked, maintenance có component rõ.
8. Layout responsive desktop/tablet/mobile hoạt động ổn ở các flow P0.
9. Layout dùng API/query hooks chung, không gọi fetch rời rạc.
10. Layout không hard-code role.
11. Dirty form guard hoạt động cho chuyển route/app.
12. Logout clear session, query cache nhạy cảm và layout state.
13. Có unit/component/E2E smoke test cho layout foundation.
14. Có checklist còn lại cho các module frontend tiếp theo.

---

## 39. Kết luận

FRONTEND-05 là bước dựng **app shell thật** cho toàn bộ frontend.

Tư duy triển khai chính:

```text
ProtectedShell ổn định
-> GlobalTopbar chung
-> HomePortalLayout rõ
-> AppSwitcher dùng mọi nơi
-> ModuleWorkspaceLayout reusable
-> Sidebar theo registry + permission
-> Content shell thống nhất
-> State/responsive/accessibility đầy đủ
-> Module nghiệp vụ chỉ tập trung vào business UI
```

Sau FRONTEND-05, đội frontend có thể triển khai các màn nghiệp vụ trên nền layout đã ổn định:

```text
FRONTEND-06: AUTH & Account Frontend
FRONTEND-07: Dashboard Frontend
FRONTEND-08: HR Frontend
FRONTEND-09: Attendance Frontend
FRONTEND-10: Leave Frontend
FRONTEND-11: Task Frontend
FRONTEND-12: Notification Frontend
FRONTEND-13: System/Foundation Frontend
```
