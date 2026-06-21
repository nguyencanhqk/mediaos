> ⚠️ **ĐÍNH CHÍNH STACK (bắt buộc) — đọc trước:** Tài liệu này có thể còn nhắc Next.js/Prisma (lỗi thời). Stack đã CHỐT: **Vite + React 19 SPA + TanStack Router (KHÔNG Next.js)** · **Drizzle (KHÔNG Prisma)** · **Valkey** · **Vitest**. Các token an toàn đã thay inline; phần khái niệm lấy [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md) làm chuẩn.

# FRONTEND-01: FRONTEND ARCHITECTURE & PROJECT SETUP
# KIẾN TRÚC FRONTEND & THIẾT LẬP DỰ ÁN

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> **FRONTEND-01 Kiến trúc & Setup** · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Đặc tả: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [IA/Sitemap: UI-02](<../UI/UI-02_Information_Architecture_Sitemap.md>) · [Design System: UI-05](<../UI/UI-05_Design_System_Component_Library.md>) · [Chuẩn API: API-01](<../API Design/API-01 TỔNG QUAN.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-01 |
| Tên tài liệu | Frontend Architecture & Project Setup |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này định nghĩa kiến trúc frontend và kế hoạch thiết lập project frontend cho hệ thống quản lý doanh nghiệp nội bộ.

FRONTEND-01 là tài liệu mở đầu của giai đoạn frontend implementation. Tài liệu này dùng để:

1. Chốt stack frontend chính cho MVP.
2. Chốt kiến trúc thư mục frontend.
3. Chốt cách tổ chức route, layout, module và registry.
4. Chốt chiến lược authentication, session, token và route guard.
5. Chốt chiến lược permission, data scope, app visibility, menu visibility và action visibility.
6. Chốt chiến lược API client, response/error handling, upload, retry và request metadata.
7. Chốt chiến lược state management cho server-state, client-state, form-state và UI-state.
8. Chốt nguyên tắc implement Design System từ UI-05.
9. Chốt quy ước code, naming, TypeScript, validation, test và build.
10. Làm nền cho các tài liệu frontend tiếp theo.

FRONTEND-01 không đi sâu vào code chi tiết từng màn hình nghiệp vụ. Các màn hình cụ thể sẽ được triển khai trong các tài liệu FRONTEND-02 trở đi.

---

## 3. Vị trí của FRONTEND-01 trong chuỗi tài liệu

Chuỗi tài liệu dự án hiện tại:

```text
PRD/SPEC
  -> Database Design
  -> API Design
  -> UI/UX Design
  -> Prototype & Frontend Handoff
  -> Frontend Implementation
```

FRONTEND-01 là bước đầu tiên của nhánh Frontend Implementation.

```text
FRONTEND-01: Frontend Architecture & Project Setup
FRONTEND-02: Design System Implementation
FRONTEND-03: Routing, Auth Guard & Permission Framework
FRONTEND-04: API Client, Query Layer & Error Handling
FRONTEND-05: Layout Implementation (Home Portal, App Switcher, Module Workspace)
FRONTEND-06: AUTH & Account Frontend
FRONTEND-07: Dashboard Frontend
FRONTEND-08: HR Frontend
FRONTEND-09: Attendance Frontend
FRONTEND-10: Leave Frontend
FRONTEND-11: Task Frontend
FRONTEND-12: Notification Frontend
FRONTEND-13: System / Foundation Frontend
FRONTEND-14: QA, Performance & Release Readiness
```

---

## 4. Căn cứ thiết kế frontend

Frontend phải bám theo các quyết định đã chốt trong bộ tài liệu trước:

1. Sau đăng nhập, user vào **Home Portal** trước, không đi thẳng vào dashboard nghiệp vụ.
2. Từ Home Portal, user chọn app/module để vào **Module Workspace**.
3. Trong mọi màn protected, user có thể bấm nút **Ứng dụng** để mở **App Switcher**.
4. Module Workspace dùng sidebar riêng theo module và topbar chung toàn hệ thống.
5. Frontend được phép ẩn/hiện UI để cải thiện trải nghiệm, nhưng backend vẫn là lớp kiểm tra quyền cuối cùng.
6. App, menu, route, button, field, widget, badge và counter phải hiển thị theo permission và data scope.
7. Dashboard, Home Portal và App Switcher chỉ tổng hợp/điều hướng, không xử lý nghiệp vụ gốc.
8. Notification deep link và Dashboard quick action phải điều hướng sang module gốc để kiểm tra permission, data scope và business rule lại.
9. Mọi màn nghiệp vụ phải dùng component, token và state đã định nghĩa ở UI-05.
10. Mỗi màn hình cần có screen code, route, layout, module code, permission, data scope, API mapping, state, responsive note và QA focus.

---

## 5. Phạm vi FRONTEND-01

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Frontend stack | Framework, language, styling, form, query, table, test |
| Project setup | Package manager, scripts, env, alias, lint, format |
| Folder structure | Cấu trúc `src`, `app`, `modules`, `components`, `services`, `routes` |
| Routing architecture | Public route, protected route, Home Portal, Module Workspace |
| Layout architecture | AuthLayout, HomePortalLayout, ModuleWorkspaceLayout |
| Registry architecture | App registry, route registry, sidebar registry, action registry |
| Auth architecture | Login, logout, refresh token, session bootstrap |
| Permission architecture | PermissionGate, RouteGuard, ActionGuard, FieldGuard |
| API client | Request, response, error, retry, token injection, request id |
| State management | Server-state, client-state, form-state, UI-state |
| Development convention | Naming, TypeScript, component pattern, module boundary |
| Setup checklist | Các bước khởi tạo project frontend |
| Acceptance criteria | Tiêu chí hoàn thành FRONTEND-01 |

### 5.2 Không bao gồm

| Nội dung | Tài liệu xử lý sau |
| --- | --- |
| Implement toàn bộ Design System | FRONTEND-02 |
| Code chi tiết auth flow | FRONTEND-03 |
| Code chi tiết Home Portal/App Switcher | FRONTEND-05 |
| Code chi tiết ModuleWorkspaceLayout | FRONTEND-05 |
| API client nâng cao và query key đầy đủ | FRONTEND-04 |
| Implement từng màn HR/ATT/LEAVE/TASK/NOTI | FRONTEND-08/09/10/11/12 |
| Test plan chi tiết | FRONTEND-14 |
| CI/CD, deploy, release | FRONTEND-14 |

---

## 6. Định hướng kiến trúc frontend tổng thể

Frontend của hệ thống này cần được xây dựng như một **Enterprise SaaS Web Platform** thay vì một tập hợp các trang CRUD rời rạc.

Kiến trúc tổng thể chia thành 7 lớp:

```text
1. App Runtime Layer
   -> Framework, routing, providers, environment, build

2. App Shell Layer
   -> Auth shell, protected shell, root provider, error boundary

3. Design System Layer
   -> Token, component foundation, layout component, state component

4. Navigation & Registry Layer
   -> App registry, route registry, sidebar registry, action metadata

5. Auth & Permission Layer
   -> Session, permission, data scope, route guard, action guard

6. API & State Layer
   -> API client, server-state cache, mutation, form, error handling

7. Feature Module Layer
   -> AUTH, HOME, DASH, HR, ATT, LEAVE, TASK, NOTI, SYSTEM
```

Nguyên tắc quan trọng:

```text
Layout dùng chung
-> Route theo metadata
-> Menu theo permission
-> Data theo API
-> Action theo allowed_actions/business rule
-> State đầy đủ
-> Backend là guard cuối cùng
```

---

## 7. Stack frontend đề xuất

### 7.1 Stack chính

| Nhóm | Công nghệ đề xuất | Vai trò |
| --- | --- | --- |
| Framework | Next.js App Router | Routing, layout, SSR/CSR linh hoạt |
| UI runtime | React | Component model |
| Language | TypeScript | Type safety |
| Styling | Tailwind CSS + CSS Variables | Utility-first + design token |
| UI primitive | Radix UI hoặc shadcn/ui | Accessible base component |
| Server-state | TanStack Query | Fetch, cache, sync, mutation |
| Form | React Hook Form | Form state hiệu năng cao |
| Validation | Zod | Schema validation + TypeScript inference |
| Table | TanStack Table | Data table phức tạp |
| Client-state | Zustand hoặc React Context | UI state nhỏ, app switcher, sidebar |
| Date | date-fns hoặc dayjs | Format date/time |
| Icon | lucide-react hoặc icon package riêng | Icon nhất quán |
| Test unit | Vitest | Unit test nhanh |
| Test component | Testing Library | Test component theo hành vi |
| E2E | Playwright | Test user flow |
| Component docs | Storybook | Tài liệu component và visual review |

### 7.2 Lý do chọn Next.js App Router

Hệ thống có nhiều layout nested:

```text
AuthLayout
HomePortalLayout
ModuleWorkspaceLayout
DashboardLayout
```

Next.js App Router phù hợp vì có thể tổ chức route theo layout group, route segment và nested layout.

Ví dụ:

```text
app/
  (public)/
    login/
    forgot-password/
  (protected)/
    home/
    dashboard/
    hr/
    attendance/
    leave/
    tasks/
    notifications/
    system/
```

### 7.3 Lý do chọn TanStack Query

Hệ thống phụ thuộc nhiều vào server-state:

1. Auth profile.
2. Permission.
3. App registry.
4. Dashboard widget.
5. Employee list.
6. Attendance records.
7. Leave requests.
8. Task list.
9. Notification unread count.

TanStack Query phù hợp để cache, refetch, invalidate, optimistic update và kiểm soát loading/error state.

### 7.4 Lý do chọn React Hook Form + Zod

Hệ thống có nhiều form nghiệp vụ dài:

1. Employee form.
2. Profile change request.
3. Attendance adjustment request.
4. Leave request form.
5. Task form.
6. Role-permission configuration.
7. System settings.

React Hook Form xử lý form-state tốt, còn Zod giúp chuẩn hóa schema validation phía frontend và có thể share type với backend nếu kiến trúc cho phép.

---

## 8. Quyết định stack chính thức cho MVP

### 8.1 Stack MVP mặc định

```text
Next.js + React + TypeScript
Tailwind CSS + CSS Variables
TanStack Query
React Hook Form + Zod
TanStack Table
Zustand
Vitest + Testing Library + Playwright
Storybook
```

### 8.2 Nguyên tắc không khóa cứng vào vendor

Không để toàn bộ business logic phụ thuộc vào UI library cụ thể.

Đúng:

```text
components/ui/Button.tsx
components/ui/DataTable.tsx
components/forms/FormField.tsx
```

Không nên:

```text
Dùng trực tiếp component của thư viện ở mọi màn nghiệp vụ
```

Lý do: nếu sau này đổi UI primitive hoặc theme, chỉ refactor ở Design System Layer.

---

## 9. Project setup đề xuất

### 9.1 Package manager

Khuyến nghị dùng:

```text
pnpm
```

Lý do:

1. Cài dependency nhanh.
2. Quản lý monorepo tốt nếu sau này tách package.
3. Lockfile rõ ràng.
4. Phù hợp khi phát triển thêm shared package cho UI, API types, eslint config.

### 9.2 Lệnh khởi tạo project

```bash
pnpm create next-app enterprise-management-web \
  --typescript \
  --eslint \
  --app \
  --src-dir \
  --tailwind \
  --import-alias "@/*"
```

Nếu không dùng `pnpm create`, có thể dùng:

```bash
npx create-next-app@latest enterprise-management-web \
  --typescript \
  --eslint \
  --app \
  --src-dir \
  --tailwind \
  --import-alias "@/*"
```

### 9.3 Dependency nền đề xuất

```bash
pnpm add @tanstack/react-query @tanstack/react-table
pnpm add react-hook-form zod @hookform/resolvers
pnpm add zustand
pnpm add clsx tailwind-merge class-variance-authority
pnpm add date-fns
pnpm add lucide-react
pnpm add uuid
```

### 9.4 Dependency dev đề xuất

```bash
pnpm add -D prettier eslint-config-prettier
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom
pnpm add -D playwright
pnpm add -D storybook @storybook/nextjs
```

### 9.5 Scripts đề xuất

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:e2e": "playwright test",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  }
}
```

---

## 10. Environment strategy

### 10.1 Các môi trường

| Môi trường | Mục đích |
| --- | --- |
| Local | Dev cá nhân |
| Development | Dev chung với backend dev |
| Staging | QA/UAT |
| Production | Người dùng thật |

### 10.2 File env đề xuất

```text
.env.example
.env.local
.env.development
.env.staging
.env.production
```

### 10.3 Biến môi trường frontend

```env
VITE_APP_NAME="Enterprise Management System"
VITE_APP_ENV="local"
VITE_API_BASE_URL="http://localhost:3000/api/v1"
VITE_INTERNAL_BUILD_VERSION="0.1.0"
VITE_ENABLE_MOCK_API="false"
VITE_ENABLE_STORYBOOK="true"
VITE_ENABLE_DEBUG_PANEL="true"
```

### 10.4 Nguyên tắc env

1. Biến có prefix `VITE_` sẽ expose ra browser, không chứa secret.
2. Không lưu access token, refresh token, API secret, storage secret trong env frontend.
3. Base URL phải đổi theo môi trường build/deploy.
4. Không hard-code domain API trong source code.
5. Build version nên hiển thị ở trang system/about hoặc debug panel.

---

## 11. Cấu trúc thư mục tổng thể

### 11.1 Folder structure đề xuất

```text
src/
  app/
    (public)/
      login/
        page.tsx
      forgot-password/
        page.tsx
      reset-password/
        page.tsx
    (protected)/
      layout.tsx
      home/
        page.tsx
      dashboard/
        page.tsx
        employee/
          page.tsx
        manager/
          page.tsx
        hr/
          page.tsx
        admin/
          page.tsx
      hr/
        page.tsx
        employees/
          page.tsx
          [employeeId]/
            page.tsx
      attendance/
        page.tsx
        today/
          page.tsx
        records/
          page.tsx
      leave/
        page.tsx
        me/
          requests/
            page.tsx
          balances/
            page.tsx
        requests/
          new/
            page.tsx
          [requestId]/
            page.tsx
        approvals/
          page.tsx
      tasks/
        page.tsx
        my-tasks/
          page.tsx
        projects/
          page.tsx
        kanban/
          page.tsx
      notifications/
        page.tsx
      system/
        page.tsx
    api/
      health/
        route.ts
  components/
    ui/
    forms/
    data-table/
    feedback/
    permission/
    navigation/
    workflow/
    domain/
  layouts/
    AuthLayout/
    HomePortalLayout/
    ModuleWorkspaceLayout/
  modules/
    auth/
    home/
    dashboard/
    hr/
    attendance/
    leave/
    tasks/
    notifications/
    system/
  providers/
    AppProviders.tsx
    QueryProvider.tsx
    AuthProvider.tsx
    ThemeProvider.tsx
  services/
    api/
    auth/
    storage/
    telemetry/
  routes/
    appRegistry.ts
    routeRegistry.ts
    sidebarRegistry.ts
    actionRegistry.ts
  hooks/
  lib/
    constants/
    errors/
    formatters/
    guards/
    validators/
  stores/
  types/
  styles/
    globals.css
    tokens.css
```

### 11.2 Nguyên tắc phân chia

| Folder | Vai trò |
| --- | --- |
| `app` | Route entry, page, layout theo Next.js |
| `components` | Component dùng chung, không chứa business module sâu |
| `layouts` | Layout shell lớn: Auth, Home, Workspace |
| `modules` | Feature module: UI, hooks, service, schema riêng của từng module |
| `providers` | Provider toàn app |
| `services` | API client, auth service, storage service |
| `routes` | Metadata app/route/sidebar/action |
| `stores` | Client-state nhỏ |
| `lib` | Helper thuần, không phụ thuộc React nếu có thể |
| `types` | Type dùng chung |
| `styles` | Global CSS, token CSS |

---

## 12. Module folder convention

Mỗi module nên có cấu trúc tương tự nhau để dễ scale.

Ví dụ module `leave`:

```text
modules/leave/
  components/
    LeaveBalanceCard.tsx
    LeaveRequestStatusBadge.tsx
    LeaveRequestForm.tsx
    LeaveApprovalBox.tsx
  hooks/
    useMyLeaveBalances.ts
    useLeaveRequests.ts
    useCreateLeaveRequest.ts
    useApproveLeaveRequest.ts
  pages/
    LeaveOverviewPage.tsx
    MyLeaveRequestsPage.tsx
    CreateLeaveRequestPage.tsx
    LeaveApprovalsPage.tsx
    LeaveRequestDetailPage.tsx
  services/
    leave.api.ts
    leave.keys.ts
  schemas/
    leave-request.schema.ts
  types/
    leave.types.ts
  utils/
    leave-formatters.ts
    leave-status.ts
  index.ts
```

Nguyên tắc:

1. `pages` chứa component màn hình lớn, được import bởi Next.js page entry.
2. `components` chứa component module-specific.
3. `hooks` chứa hook query/mutation module.
4. `services` chứa API function và query key.
5. `schemas` chứa Zod schema cho form.
6. `types` chứa DTO/type riêng của module.
7. `utils` chứa helper thuần của module.

---

## 13. Route architecture

### 13.1 Route group

```text
(public)
  -> Không yêu cầu đăng nhập

(protected)
  -> Yêu cầu đăng nhập
  -> Load auth context
  -> Load permission context
  -> Kiểm tra route guard
```

### 13.2 Route chính MVP

| Route | Layout | Mô tả |
| --- | --- | --- |
| `/login` | AuthLayout | Đăng nhập |
| `/forgot-password` | AuthLayout | Quên mật khẩu |
| `/reset-password` | AuthLayout | Đặt lại mật khẩu |
| `/home` | HomePortalLayout | Home Portal sau đăng nhập |
| `/dashboard` | ModuleWorkspaceLayout | Dashboard module |
| `/hr` | ModuleWorkspaceLayout | HR module |
| `/attendance` | ModuleWorkspaceLayout | ATT module |
| `/leave` | ModuleWorkspaceLayout | LEAVE module |
| `/tasks` | ModuleWorkspaceLayout | TASK module |
| `/notifications` | ModuleWorkspaceLayout | NOTI module |
| `/system` | ModuleWorkspaceLayout | SYSTEM/FOUNDATION/AUTH admin |

### 13.3 Route metadata

Frontend không nên chỉ dựa vào file path. Cần có route metadata để kiểm soát permission, layout, screen code và sidebar.

```ts
export interface AppRouteMeta {
  routeKey: string;
  path: string;
  layout: 'AUTH' | 'HOME_PORTAL' | 'MODULE_WORKSPACE';
  moduleCode?: ModuleCode;
  screenCode?: string;
  title: string;
  description?: string;
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: DataScope[];
  featureFlag?: string;
  sidebarKey?: string;
  showInSidebar?: boolean;
  order?: number;
  pageTemplate?: PageTemplate;
}
```

### 13.4 Ví dụ route metadata

```ts
export const leaveApprovalRoute: AppRouteMeta = {
  routeKey: 'leave.approvals.list',
  path: '/leave/approvals',
  layout: 'MODULE_WORKSPACE',
  moduleCode: 'LEAVE',
  screenCode: 'UI-LEAVE-SCREEN-APPROVALS',
  title: 'Đơn nghỉ cần duyệt',
  sidebarKey: 'leave.approvals',
  requiredAnyPermissions: ['LEAVE.REQUEST.APPROVE'],
  requiredScopes: ['Team', 'Department', 'Company', 'System'],
  showInSidebar: true,
  order: 30,
  pageTemplate: 'APPROVAL'
};
```

### 13.5 Route guard behavior

| Trạng thái | UI behavior |
| --- | --- |
| Chưa đăng nhập | Redirect `/login` |
| Token hết hạn | Thử refresh token, nếu fail redirect `/login` |
| Không có permission | Hiển thị ForbiddenPage hoặc redirect về `/home` tùy route |
| Module disabled | Hiển thị DisabledModuleState |
| Feature flag off | Hide route hoặc ComingSoon/Locked theo policy |
| Có permission nhưng scope không phù hợp | Empty due to scope hoặc Forbidden tùy endpoint |
| Route không tồn tại | NotFoundPage |

---

## 14. Layout architecture

### 14.1 Root providers

Root app cần các provider:

```text
AppProviders
  -> QueryProvider
  -> AuthProvider
  -> PermissionProvider
  -> ThemeProvider
  -> ToastProvider
  -> DirtyFormProvider
  -> AppSwitcherProvider
```

### 14.2 AuthLayout

Dùng cho:

```text
/login
/forgot-password
/reset-password
```

Thành phần:

1. Logo/product name.
2. Auth card.
3. Background/illustration optional.
4. Form error summary.
5. Build version hoặc environment indicator ở local/dev.

### 14.3 HomePortalLayout

Dùng cho:

```text
/home
```

Thành phần:

1. Home header.
2. User greeting.
3. App search.
4. App category chips.
5. Favorite apps.
6. Recent apps.
7. My apps grid.
8. Notification/avatar entry.

### 14.4 ModuleWorkspaceLayout

Dùng cho:

```text
/dashboard
/hr
/attendance
/leave
/tasks
/notifications
/system
```

Thành phần:

1. GlobalTopbar.
2. ModuleSidebar.
3. MainContentShell.
4. Breadcrumb.
5. PageHeader.
6. Toolbar.
7. PageBody.
8. Drawer/modal/toast layer.
9. AppSwitcher overlay.

### 14.5 Layout không xử lý nghiệp vụ gốc

Layout chỉ chịu trách nhiệm:

1. Điều hướng.
2. Frame giao diện.
3. Guard cơ bản.
4. State shell.
5. Render children.

Layout không tự xử lý nghiệp vụ như:

1. Check-in.
2. Approve leave.
3. Update task.
4. Mark notification read.
5. Update employee.

Các action đó phải gọi module API/service tương ứng.

---

## 15. App registry architecture

### 15.1 Mục đích

App registry quyết định app/module nào hiển thị ở Home Portal và App Switcher.

### 15.2 Nguồn dữ liệu app registry

Có 2 hướng:

| Hướng | Mô tả | MVP đề xuất |
| --- | --- | --- |
| Backend-driven | Backend trả app theo permission/module status/company setting | Mục tiêu chính thức |
| Hybrid | Frontend có config local, backend trả permission/active modules | Tạm dùng nếu API chưa sẵn sàng |

### 15.3 App registry type

```ts
export interface AppRegistryItem {
  moduleCode: ModuleCode;
  name: string;
  shortName?: string;
  description: string;
  icon: string;
  rootPath: string;
  defaultRoute: string;
  category: 'core' | 'hr' | 'operation' | 'collaboration' | 'system' | 'future';
  requiredAnyPermissions?: string[];
  requiredScopes?: DataScope[];
  status: 'active' | 'locked' | 'coming_soon' | 'maintenance' | 'hidden';
  isFavorite?: boolean;
  isRecent?: boolean;
  order: number;
}
```

### 15.4 App registry MVP

| Module | App name | Root path | Status MVP |
| --- | --- | --- | --- |
| DASH | Dashboard | `/dashboard` | Active |
| HR | Nhân sự | `/hr` | Active |
| ATT | Chấm công | `/attendance` | Active |
| LEAVE | Nghỉ phép | `/leave` | Active |
| TASK | Công việc | `/tasks` | Active |
| NOTI | Thông báo | `/notifications` | Active |
| AUTH/FOUNDATION | Hệ thống | `/system` | Active theo quyền |
| PAYROLL | Tiền lương | `/payroll` | Hidden/Coming soon |
| RECRUIT | Tuyển dụng | `/recruit` | Hidden/Coming soon |
| ASSET | Tài sản | `/assets` | Hidden/Coming soon |
| ROOM | Phòng họp | `/rooms` | Hidden/Coming soon |
| CHAT | Chat nội bộ | `/chat` | Hidden/Coming soon |
| SOCIAL | Mạng xã hội | `/social` | Hidden/Coming soon |
| AI | AI & Automation | `/ai` | Hidden/Coming soon |

---

## 16. Sidebar registry architecture

### 16.1 Mục đích

Sidebar registry quyết định menu trong từng Module Workspace.

### 16.2 Sidebar item type

```ts
export interface SidebarItemMeta {
  key: string;
  moduleCode: ModuleCode;
  label: string;
  path?: string;
  icon?: string;
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
  isComingSoon?: boolean;
}
```

### 16.3 Quy tắc render sidebar

1. Không hard-code menu theo role.
2. Chỉ render item khi user có permission phù hợp.
3. Nếu item có `requiredScopes`, user phải có ít nhất một scope phù hợp.
4. Nếu module disabled thì sidebar hiển thị disabled module state.
5. Badge/counter phải lấy từ API theo đúng data scope.
6. Không hiển thị số lượng dữ liệu ngoài phạm vi quyền của user.
7. Menu cha chỉ hiện nếu có ít nhất một menu con hợp lệ.

---

## 17. Auth architecture

### 17.1 Thành phần auth frontend

| Thành phần | Vai trò |
| --- | --- |
| `AuthProvider` | Lưu trạng thái auth trong app runtime |
| `auth.api.ts` | Gọi login/logout/refresh/me |
| `auth.store.ts` | Lưu client auth state nếu dùng Zustand |
| `useAuth()` | Hook đọc user/session |
| `useSessionBootstrap()` | Bootstrap auth context khi app load |
| `ProtectedRoute` | Guard route cần login |
| `GuestRoute` | Redirect khỏi login nếu đã đăng nhập |

### 17.2 Auth bootstrap flow

```text
App load
-> Kiểm tra token/session local
-> Gọi /auth/me hoặc /auth/session nếu có token
-> Load user profile
-> Load permissions/data scopes
-> Load active modules/company settings
-> Set auth context ready
-> Render protected app
```

### 17.3 Login flow

```text
User submit login form
-> POST /api/v1/auth/login
-> Nhận access token + refresh token theo contract backend
-> Lưu token theo chiến lược bảo mật đã chốt
-> Gọi /api/v1/auth/me
-> Gọi permissions/app registry nếu backend không trả cùng auth/me
-> Redirect /home
```

### 17.4 Logout flow

```text
User click logout
-> POST /api/v1/auth/logout nếu API có
-> Clear token/session local
-> Clear query cache nhạy cảm
-> Redirect /login
```

### 17.5 Refresh token flow

```text
API trả 401 token expired
-> Nếu chưa refresh: gọi /api/v1/auth/refresh-token
-> Cập nhật access token
-> Retry request gốc một lần
-> Nếu refresh fail: logout + redirect /login
```

### 17.6 Token storage strategy

Có 2 phương án:

| Phương án | Ưu điểm | Nhược điểm | Khuyến nghị |
| --- | --- | --- | --- |
| HttpOnly cookie | An toàn hơn trước XSS | Cần backend/cors/cookie config kỹ | Tốt nhất nếu backend hỗ trợ |
| In-memory + refresh cookie | Giảm rủi ro localStorage | Phức tạp hơn | Tốt cho SPA/Next client |
| localStorage | Dễ triển khai | Rủi ro XSS cao | Chỉ dùng tạm trong dev/mock |

Khuyến nghị MVP production:

```text
Access token: memory hoặc HttpOnly cookie tùy backend
Refresh token: HttpOnly Secure SameSite cookie nếu có thể
```

Nếu backend chưa hỗ trợ cookie auth, frontend có thể dùng token storage tạm thời nhưng phải ghi rõ rủi ro và có kế hoạch chuyển.

---

## 18. Permission & data scope architecture

### 18.1 Không hard-code theo role

Không dùng:

```ts
if (user.role === 'HR') {
  showEmployeeMenu();
}
```

Dùng:

```ts
if (can('HR.EMPLOYEE.VIEW')) {
  showEmployeeMenu();
}
```

### 18.2 Type permission context

```ts
export type DataScope = 'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System';

export interface UserPermission {
  permission: string;
  scopes: DataScope[];
}

export interface PermissionContextValue {
  permissions: UserPermission[];
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
  canAll: (permissions: string[]) => boolean;
  getScopes: (permission: string) => DataScope[];
  hasScope: (permission: string, scope: DataScope) => boolean;
  canRoute: (route: AppRouteMeta) => boolean;
  canAction: (action: ActionMeta, row?: unknown) => boolean;
}
```

### 18.3 Permission utility behavior

| Utility | Mục đích |
| --- | --- |
| `can(permission)` | Kiểm tra có permission |
| `canAny(permissions)` | Có ít nhất một permission |
| `canAll(permissions)` | Có tất cả permission |
| `getScopes(permission)` | Lấy scope hiệu lực của permission |
| `hasScope(permission, scope)` | Kiểm tra scope cụ thể |
| `canRoute(routeMeta)` | Kiểm tra route visibility/access |
| `canAction(actionMeta, row)` | Kiểm tra action visibility/disabled |

### 18.4 Permission UI component

```tsx
<PermissionGate
  anyPermissions={["LEAVE.REQUEST.APPROVE"]}
  scopes={["Team", "Department", "Company", "System"]}
  fallback={null}
>
  <ApproveButton />
</PermissionGate>
```

### 18.5 Guard phân tầng

| Tầng | Mục đích | Có phải bảo mật cuối cùng? |
| --- | --- | --- |
| App registry guard | Ẩn app không có quyền | Không |
| Route guard | Chặn route trái quyền ở frontend | Không |
| Sidebar guard | Ẩn menu không có quyền | Không |
| Action guard | Ẩn/disable button | Không |
| Field guard | Mask/ẩn field nhạy cảm | Không |
| Backend API guard | Kiểm tra auth, permission, scope, rule | Có |

### 18.6 Allowed actions

Với các entity có workflow, frontend không nên tự đoán toàn bộ rule.

Ví dụ response detail nên có:

```json
{
  "id": "...",
  "status": "Pending",
  "allowed_actions": ["approve", "reject", "comment"]
}
```

Frontend dùng `allowed_actions` để:

1. Hiển thị action.
2. Disable action kèm tooltip.
3. Tránh submit thao tác chắc chắn lỗi.

Backend vẫn kiểm tra lại khi submit.

---

## 19. API client architecture

### 19.1 API client mục tiêu

API client cần xử lý thống nhất:

1. Base URL theo env.
2. Authorization header.
3. Request id.
4. Client type/version.
5. JSON parse.
6. Success response format.
7. Error response format.
8. 401 refresh token.
9. 403 forbidden.
10. Validation error (type `ValidationError`).
11. 422 business rule (type `BusinessRuleError`).
12. 409 conflict.
13. Upload file.
14. Abort/cancel nếu cần.

### 19.2 API response type

```ts
export interface ApiMeta {
  request_id: string;
  timestamp: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  meta: ApiMeta;
  pagination?: ApiPagination;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error: {
    code: string;
    type: string;
    details: unknown;
  };
  meta: ApiMeta;
}
```

### 19.3 API client function signature

```ts
export interface ApiRequestOptions extends RequestInit {
  auth?: boolean;
  idempotencyKey?: string;
  skipRefreshToken?: boolean;
}

export async function apiRequest<T>(
  path: string,
  options?: ApiRequestOptions
): Promise<T>;
```

### 19.4 Header chuẩn từ frontend

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
X-Request-Id: <uuid>
X-Client-Type: web
X-Client-Version: <build_version>
Idempotency-Key: <uuid> nếu API quan trọng
```

### 19.5 Error mapping UI

| HTTP/Error | UI behavior |
| --- | --- |
| 400 `ValidationError` | Inline validation + error summary |
| 401 | Refresh token hoặc redirect login |
| 403 | Forbidden state, không lộ dữ liệu |
| 404 | NotFound state |
| 409 | Conflict alert, refetch data |
| 422 `BusinessRuleError` | Business rule alert trong card/form |
| 429 | Rate limit message + retry later |
| 500 | ErrorState + request id + retry |

### 19.6 Query key convention

```ts
export const leaveKeys = {
  all: ['leave'] as const,
  balances: () => [...leaveKeys.all, 'balances'] as const,
  myRequests: (filters: LeaveRequestFilters) => [...leaveKeys.all, 'my-requests', filters] as const,
  detail: (id: string) => [...leaveKeys.all, 'requests', id] as const,
  approvals: (filters: LeaveApprovalFilters) => [...leaveKeys.all, 'approvals', filters] as const
};
```

### 19.7 Invalidation convention

| Mutation | Invalidate |
| --- | --- |
| Check-in/check-out | attendance today, attendance records, dashboard widget attendance |
| Create leave request | leave my requests, leave balances, dashboard leave widgets |
| Approve/reject leave | leave approvals, leave detail, attendance records if synced, dashboard widgets |
| Update task status | task detail, my tasks, kanban, dashboard task widgets |
| Mark notification read | notification unread count, notification dropdown/list |

---

## 20. State management architecture

### 20.1 Phân loại state

| Loại state | Công cụ | Ví dụ |
| --- | --- | --- |
| Server-state | TanStack Query | Employee list, leave requests, dashboard widgets |
| Form-state | React Hook Form | Leave form, employee form, task form |
| Validation-state | Zod + RHF resolver | Field validation |
| Global UI-state | Zustand/Context | App Switcher open, sidebar collapsed, theme |
| Auth-state | AuthProvider + Query | User profile, permission context |
| URL-state | Search params | Pagination, filter, sort, tab |
| Local UI-state | useState | Modal open, selected row |

### 20.2 Nguyên tắc

1. Không copy server-state vào Zustand nếu không cần.
2. Filter/sort/pagination nên đồng bộ URL search params cho màn danh sách chính.
3. Form-state giữ trong React Hook Form.
4. Auth/permission phải bootstrap trước khi render protected app.
5. App Switcher/sidebar/theme có thể dùng Zustand hoặc Context.
6. Dirty form state cần quản lý dùng chung để chặn chuyển route/app.

### 20.3 Client stores đề xuất

```text
stores/
  app-shell.store.ts       -> sidebar collapsed, app switcher open
  dirty-form.store.ts      -> form dirty registry
  theme.store.ts           -> light/dark/system nếu có
  recent-app.store.ts      -> local recent app fallback nếu backend chưa có
```

---

## 21. Form architecture

### 21.1 Form stack

```text
React Hook Form
+ Zod schema
+ FormField component
+ API validation error mapper
+ Dirty form guard
```

### 21.2 Form convention

```text
schemas/
  leave-request.schema.ts
components/
  LeaveRequestForm.tsx
hooks/
  useCreateLeaveRequest.ts
```

### 21.3 Validation rule

1. Frontend validate để cải thiện UX.
2. Backend validate là nguồn kiểm soát cuối cùng.
3. Validation message phải thống nhất UX copy.
4. API 422 phải map được vào từng field.
5. Form dài phải có error summary.
6. Dirty form phải cảnh báo khi rời route/app.

### 21.4 API validation error mapper

```ts
export function mapValidationErrorsToForm(
  details: ApiValidationDetail[],
  setError: UseFormSetError<any>
) {
  for (const item of details) {
    setError(item.field, {
      type: item.rule,
      message: item.message
    });
  }
}
```

### 21.5 Dirty form guard

Dirty guard áp dụng cho:

1. Tạo đơn nghỉ.
2. Sửa hồ sơ nhân viên.
3. Gửi yêu cầu sửa hồ sơ cá nhân.
4. Tạo/sửa task.
5. Role-permission matrix.
6. System settings.

Khi user chuyển app bằng App Switcher hoặc rời route:

```text
Nếu form dirty
-> Hiển thị ConfirmDialog
-> Rời trang / Ở lại
```

---

## 22. Design System implementation boundary

FRONTEND-01 chưa triển khai chi tiết Design System nhưng chốt boundary như sau:

### 22.1 Component layer

```text
components/ui
  -> Button, Input, Select, Badge, Card, Modal, Drawer, Toast

components/forms
  -> FormField, DatePickerField, SelectField, UploadField

components/data-table
  -> DataTable, DataTableToolbar, Pagination, ColumnVisibility

components/permission
  -> PermissionGate, MaskedField, ForbiddenPage, LockedApp

components/navigation
  -> AppCard, SidebarItem, Breadcrumb, Tabs

components/workflow
  -> ApprovalBox, StatusStepper, CommentThread, Checklist

components/domain
  -> AttendanceStatusCard, LeaveBalanceCard, TaskCard, EmployeeProfileHeader
```

### 22.2 Không để module tự tạo pattern mới

Nếu module cần component mới:

1. Kiểm tra component chung đã có chưa.
2. Nếu là pattern dùng lại nhiều module, đưa vào `components` chung.
3. Nếu chỉ dùng riêng module, đặt trong `modules/<module>/components`.
4. Nếu component có visual pattern mới, cần cập nhật FRONTEND-02/Storybook.

---

## 23. TypeScript convention

### 23.1 Nguyên tắc

1. Không dùng `any` nếu không có lý do rõ.
2. DTO từ API nên có type riêng.
3. Form value type có thể infer từ Zod schema.
4. Enum/string union phải chuẩn hóa.
5. Type dùng chung đặt trong `types/`.
6. Type module đặt trong `modules/<module>/types`.

### 23.2 Naming convention

| Loại | Quy ước | Ví dụ |
| --- | --- | --- |
| Component | PascalCase | `LeaveRequestForm` |
| Hook | camelCase bắt đầu bằng use | `useLeaveRequests` |
| Type/interface | PascalCase | `LeaveRequestDto` |
| Constant | UPPER_SNAKE_CASE hoặc camelCase object | `MODULE_CODES` |
| API file | kebab/camel theo module | `leave.api.ts` |
| Query keys | `<module>.keys.ts` | `leave.keys.ts` |
| Schema | `<domain>.schema.ts` | `leave-request.schema.ts` |

### 23.3 Import alias

```ts
import { Button } from '@/components/ui/Button';
import { apiRequest } from '@/services/api/api-client';
import { useAuth } from '@/modules/auth/hooks/useAuth';
import { routeRegistry } from '@/routes/routeRegistry';
```

---

## 24. Data table architecture

### 24.1 Màn danh sách dùng DataTable

1. Employee list.
2. Attendance records.
3. Attendance adjustment requests.
4. Leave requests.
5. Leave approvals.
6. Task list.
7. Notification list.
8. User list.
9. Role list.
10. Audit log.

### 24.2 DataTable feature MVP

| Feature | Bắt buộc MVP |
| --- | --- |
| Loading skeleton | Có |
| Empty state | Có |
| Error state | Có |
| Pagination | Có |
| Sort | Có nếu API hỗ trợ |
| Filter | Có |
| Search | Có |
| Row action | Có |
| Bulk action | Có nếu nghiệp vụ cần |
| Column visibility | Có thể phase sau |
| Export | Theo quyền |

### 24.3 URL query params

```text
/hr/employees?page=1&per_page=20&keyword=an&department_id=...&status=active&sort=created_at:desc
```

Nguyên tắc:

1. Filter chính nên nằm trên URL để share/reload không mất state.
2. DataTable đọc filter từ search params.
3. Query key bao gồm filter.
4. Reset filter cập nhật URL.

---

## 25. Notification frontend architecture

### 25.1 Thành phần

| Thành phần | Mô tả |
| --- | --- |
| NotificationBadge | Hiển thị unread count trên topbar |
| NotificationDropdown | Danh sách mới nhất |
| NotificationListPage | Trang danh sách thông báo đầy đủ |
| NotificationDetail | Chi tiết thông báo nếu cần |
| NotificationTargetLink | Điều hướng sang module gốc |

### 25.2 Polling vs realtime

MVP có thể dùng polling hoặc refetch theo interval:

```text
Unread count: refetch mỗi 30-60 giây hoặc khi app focus
Dropdown: refetch khi mở dropdown
List page: fetch theo pagination/filter
```

Realtime WebSocket/SSE có thể để phase sau nếu backend chưa sẵn sàng.

### 25.3 Deep link rule

Notification target không được bypass guard.

```text
Click notification
-> Mark read nếu phù hợp
-> Resolve target path
-> Navigate module route
-> Module route guard kiểm tra permission
-> Module API kiểm tra backend guard
```

---

## 26. Dashboard frontend architecture

### 26.1 Dashboard không xử lý nghiệp vụ gốc

Dashboard chỉ:

1. Tổng hợp dữ liệu.
2. Hiển thị widget.
3. Hiển thị alert.
4. Điều hướng nhanh.
5. Lazy load widget.
6. Fallback khi module nguồn lỗi.

Dashboard không trực tiếp thay thế module gốc để xử lý nghiệp vụ.

### 26.2 Widget query strategy

```text
GET /api/v1/dashboard/me
GET /api/v1/dashboard/{type}
GET /api/v1/dashboard/widgets/{widget_slug}
```

Frontend nên hỗ trợ:

1. Load dashboard shell trước.
2. Lazy load widget nặng.
3. Widget error riêng, không làm sập toàn dashboard.
4. Refresh từng widget nếu cần.
5. Stale data indicator nếu backend trả cache metadata.

---

## 27. File upload architecture

### 27.1 Module cần upload MVP

1. HR employee files.
2. Leave attachment.
3. Attendance adjustment evidence.
4. Remote work evidence nếu có.
5. Task/project files.

### 27.2 Upload strategy

Có 2 hướng:

| Hướng | Mô tả | Ghi chú |
| --- | --- | --- |
| Upload qua API backend | Frontend gửi multipart tới backend | Dễ kiểm soát permission/audit |
| Presigned URL | Backend cấp upload URL, frontend upload trực tiếp storage | Tốt cho file lớn, phase sau |

MVP nên bắt đầu với upload qua backend nếu file không quá lớn.

### 27.3 Upload component state

1. Idle.
2. Dragging.
3. Selected.
4. Uploading.
5. Uploaded.
6. Error.
7. File too large.
8. File type invalid.
9. Permission denied.

---

## 28. Security frontend checklist

Frontend không phải lớp bảo mật cuối cùng nhưng vẫn phải giảm rủi ro.

### 28.1 Bắt buộc

1. Không lưu secret trong frontend.
2. Không hard-code company_id để gửi nghiệp vụ.
3. Không tin dữ liệu quyền tự tạo phía client.
4. Không render dữ liệu nhạy cảm nếu backend không trả.
5. Không log token vào console.
6. Không gửi access token vào query string.
7. Không expose internal API prefix.
8. Không bypass permission bằng route direct URL.
9. Clear cache nhạy cảm khi logout.
10. Hiển thị request_id khi lỗi server để debug.

### 28.2 XSS hygiene

1. Không dùng `dangerouslySetInnerHTML` trừ khi bắt buộc.
2. Nếu render rich text/comment, phải sanitize.
3. Escape dữ liệu người dùng nhập khi hiển thị.
4. File preview phải kiểm tra mime type.

---

## 29. Accessibility guideline MVP

Frontend MVP cần đạt accessibility tối thiểu:

1. Button/action có label rõ.
2. Icon-only button phải có `aria-label`.
3. Modal/drawer trap focus.
4. Form field liên kết label/error/helper text.
5. Keyboard navigation dùng được cho menu, dropdown, modal.
6. Focus state rõ ràng.
7. Contrast đủ đọc.
8. Toast không phải cách duy nhất truyền lỗi quan trọng.
9. Table có header rõ.
10. Empty/error state có text mô tả.

---

## 30. Responsive strategy

### 30.1 Breakpoint đề xuất

| Breakpoint | Range | Mục tiêu |
| --- | --- | --- |
| Mobile | `< 768px` | Employee flow, quick action, card list |
| Tablet | `768px - 1023px` | Layout co gọn, sidebar drawer/collapsed |
| Desktop | `>= 1024px` | Productivity, table, sidebar expanded |
| Large desktop | `>= 1440px` | Dashboard/table rộng hơn |

### 30.2 Mobile priority MVP

Mobile web P0 nên ưu tiên:

1. Login.
2. Home Portal.
3. App Switcher.
4. Attendance Today.
5. Create leave request.
6. My leave requests.
7. My tasks.
8. Notification dropdown/list.

Các màn admin phức tạp như permission matrix có thể tối ưu desktop trước, mobile chỉ cần readable/blocked gracefully.

---

## 31. Mock API strategy

### 31.1 Mục đích

Khi backend chưa sẵn sàng, frontend cần mock API để:

1. Dựng UI song song.
2. Test flow.
3. Dựng Storybook.
4. Demo prototype bằng code.

### 31.2 Hướng đề xuất

| Công cụ | Mục đích |
| --- | --- |
| MSW | Mock API ở browser/test |
| Static fixture | Mock data nhanh theo module |
| Storybook args | Component state demo |

### 31.3 Nguyên tắc mock

1. Mock response phải theo API-01 response format.
2. Mock error phải có code/message/details/meta.
3. Mock permission phải đủ case Employee/Manager/HR/Admin.
4. Mock data không chứa dữ liệu nhạy cảm thật.
5. Khi backend sẵn sàng, chuyển dần từ mock sang API thật theo module.

---

## 32. Coding convention

### 32.1 Component convention

```tsx
interface EmployeeProfileHeaderProps {
  employee: EmployeeSummaryDto;
  showSensitiveInfo?: boolean;
}

export function EmployeeProfileHeader({
  employee,
  showSensitiveInfo = false
}: EmployeeProfileHeaderProps) {
  return <div>{employee.full_name}</div>;
}
```

Nguyên tắc:

1. Props interface đặt ngay trên component nếu chỉ dùng riêng.
2. Component không quá lớn; tách section nếu > 200-300 dòng.
3. Container/page lo data fetching, component con nhận props.
4. Component dùng chung không gọi API trực tiếp.
5. Domain component có thể gọi hook module nếu là smart component được quy ước rõ.

### 32.2 Hook convention

```ts
export function useLeaveRequests(filters: LeaveRequestFilters) {
  return useQuery({
    queryKey: leaveKeys.myRequests(filters),
    queryFn: () => leaveApi.getMyRequests(filters)
  });
}
```

### 32.3 API service convention

```ts
export const leaveApi = {
  getMyRequests: (filters: LeaveRequestFilters) =>
    apiRequest<PaginatedResponse<LeaveRequestDto>>('/leave/me/requests', {
      method: 'GET'
    }),

  createRequest: (payload: CreateLeaveRequestPayload) =>
    apiRequest<LeaveRequestDto>('/leave/requests', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey: crypto.randomUUID()
    })
};
```

---

## 33. Error UX convention

### 33.1 Error hiển thị theo context

| Context | UI |
| --- | --- |
| Page load error | ErrorState trong content |
| Widget error | Widget-level error, không sập dashboard |
| Form validation | Inline error + summary |
| Business rule | Alert trong card/form |
| Forbidden | ForbiddenPage hoặc state trong section |
| Server error | ErrorState + request id + retry |
| Conflict | Alert + nút reload/refetch |

### 33.2 Không chỉ dùng toast cho lỗi quan trọng

Toast phù hợp cho:

1. Lưu thành công.
2. Mark read thành công.
3. Action nhỏ thành công.

Không chỉ dùng toast cho:

1. Validation error.
2. Business rule error.
3. Forbidden.
4. Conflict.
5. Page load failure.

---

## 34. Testing strategy sơ bộ

### 34.1 Unit test

Test helper và permission utility:

1. `can()`.
2. `canAny()`.
3. `canRoute()`.
4. API error mapper.
5. Formatters.
6. Schema validation.

### 34.2 Component test

Test component:

1. Button loading/disabled.
2. DataTable empty/error/loading.
3. PermissionGate hide/show.
4. LeaveRequestForm validation.
5. AppCard status active/locked/coming soon.
6. NotificationDropdown unread/read.

### 34.3 E2E test P0

1. Login -> Home Portal.
2. Home Portal -> open Attendance.
3. App Switcher -> switch app.
4. Attendance Today -> check-in mock.
5. Create Leave Request.
6. Approve Leave Request.
7. My Tasks -> update status.
8. Notification -> deep link.
9. Direct URL forbidden.
10. Dirty form guard.

---

## 35. Setup checklist chi tiết

### 35.1 Sprint FE-01.1 - Khởi tạo project

| Mã | Công việc | Kết quả |
| --- | --- | --- |
| FE01-SETUP-001 | Init Next.js App Router + TypeScript | Project chạy local |
| FE01-SETUP-002 | Cấu hình Tailwind | `globals.css`, token base |
| FE01-SETUP-003 | Cấu hình path alias `@/*` | Import gọn |
| FE01-SETUP-004 | Cấu hình ESLint/Prettier | Lint/format chạy được |
| FE01-SETUP-005 | Cấu hình env example | `.env.example` đầy đủ |
| FE01-SETUP-006 | Cấu hình scripts | dev/build/lint/test/typecheck |

### 35.2 Sprint FE-01.2 - App shell

| Mã | Công việc | Kết quả |
| --- | --- | --- |
| FE01-SHELL-001 | Tạo AppProviders | Query/Auth/Theme/Toast shell |
| FE01-SHELL-002 | Tạo AuthLayout | Login shell |
| FE01-SHELL-003 | Tạo HomePortalLayout placeholder | `/home` render được |
| FE01-SHELL-004 | Tạo ModuleWorkspaceLayout placeholder | Module shell render được |
| FE01-SHELL-005 | Tạo basic ErrorBoundary | Bắt lỗi runtime |
| FE01-SHELL-006 | Tạo NotFound/Forbidden/Error state | State nền |

### 35.3 Sprint FE-01.3 - API/Auth foundation

| Mã | Công việc | Kết quả |
| --- | --- | --- |
| FE01-API-001 | Tạo `api-client.ts` | Gọi API chuẩn |
| FE01-API-002 | Tạo response/error types | Type API chuẩn |
| FE01-API-003 | Tạo request id middleware | Header request id |
| FE01-AUTH-001 | Tạo auth service | login/logout/me/refresh skeleton |
| FE01-AUTH-002 | Tạo AuthProvider | Auth context ready |
| FE01-AUTH-003 | Tạo ProtectedLayout guard | Chặn route chưa login |

### 35.4 Sprint FE-01.4 - Registry/permission foundation

| Mã | Công việc | Kết quả |
| --- | --- | --- |
| FE01-REG-001 | Tạo app registry local | Home/App Switcher dùng được |
| FE01-REG-002 | Tạo route registry | Route metadata nền |
| FE01-REG-003 | Tạo sidebar registry | Sidebar placeholder |
| FE01-PERM-001 | Tạo permission types | Permission/scope type |
| FE01-PERM-002 | Tạo permission utilities | `can`, `canAny`, `canRoute` |
| FE01-PERM-003 | Tạo PermissionGate | Render theo quyền |

### 35.5 Sprint FE-01.5 - Quality baseline

| Mã | Công việc | Kết quả |
| --- | --- | --- |
| FE01-QA-001 | Setup Vitest | Unit test chạy được |
| FE01-QA-002 | Setup Testing Library | Component test chạy được |
| FE01-QA-003 | Setup Playwright | E2E baseline chạy được |
| FE01-QA-004 | Setup Storybook | Storybook chạy được nếu chọn làm ngay |
| FE01-QA-005 | Add CI command checklist | Ready cho FRONTEND-14 |

---

## 36. File skeleton cần tạo sau FRONTEND-01

```text
src/services/api/api-client.ts
src/services/api/api-types.ts
src/services/api/api-errors.ts
src/modules/auth/services/auth.api.ts
src/modules/auth/hooks/useAuth.ts
src/providers/AuthProvider.tsx
src/providers/QueryProvider.tsx
src/providers/AppProviders.tsx
src/routes/appRegistry.ts
src/routes/routeRegistry.ts
src/routes/sidebarRegistry.ts
src/lib/guards/permission.ts
src/components/permission/PermissionGate.tsx
src/components/permission/ForbiddenPage.tsx
src/layouts/AuthLayout/AuthLayout.tsx
src/layouts/HomePortalLayout/HomePortalLayout.tsx
src/layouts/ModuleWorkspaceLayout/ModuleWorkspaceLayout.tsx
src/stores/app-shell.store.ts
src/stores/dirty-form.store.ts
```

---

## 37. Ví dụ code skeleton

### 37.1 API types

```ts
export interface ApiMeta {
  request_id: string;
  timestamp: string;
}

export interface ApiPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  meta: ApiMeta;
  pagination?: ApiPagination;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error: {
    code: string;
    type: string;
    details: unknown;
  };
  meta: ApiMeta;
}
```

### 37.2 Permission utility

```ts
export type DataScope = 'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System';

export interface UserPermission {
  permission: string;
  scopes: DataScope[];
}

export function createPermissionChecker(userPermissions: UserPermission[]) {
  const map = new Map(userPermissions.map((item) => [item.permission, item.scopes]));

  function can(permission: string) {
    return map.has(permission);
  }

  function canAny(permissions: string[]) {
    return permissions.some(can);
  }

  function getScopes(permission: string): DataScope[] {
    return map.get(permission) ?? [];
  }

  function hasScope(permission: string, scope: DataScope) {
    return getScopes(permission).includes(scope);
  }

  return { can, canAny, getScopes, hasScope };
}
```

### 37.3 App registry sample

```ts
export const appRegistry = [
  {
    moduleCode: 'DASH',
    name: 'Dashboard',
    description: 'Tổng quan công việc, chấm công, nghỉ phép và cảnh báo.',
    icon: 'layout-dashboard',
    rootPath: '/dashboard',
    defaultRoute: '/dashboard',
    category: 'core',
    requiredAnyPermissions: ['DASH.DASHBOARD.VIEW'],
    status: 'active',
    order: 10
  },
  {
    moduleCode: 'ATT',
    name: 'Chấm công',
    description: 'Check-in, check-out, bảng công và điều chỉnh công.',
    icon: 'clock',
    rootPath: '/attendance',
    defaultRoute: '/attendance/today',
    category: 'operation',
    requiredAnyPermissions: ['ATT.ATTENDANCE.VIEW_OWN', 'ATT.ATTENDANCE.VIEW_TEAM'],
    status: 'active',
    order: 20
  }
] as const;
```

---

## 38. Definition of Done cho FRONTEND-01

FRONTEND-01 được xem là hoàn thành khi:

1. Chốt được frontend stack MVP.
2. Có folder structure chuẩn.
3. Có route architecture rõ cho public/protected/home/module.
4. Có layout architecture rõ cho AuthLayout, HomePortalLayout và ModuleWorkspaceLayout.
5. Có app registry, route registry, sidebar registry concept.
6. Có auth/session/token strategy.
7. Có permission/data scope strategy không hard-code theo role.
8. Có API client strategy bám API-01.
9. Có state management strategy.
10. Có form/validation strategy.
11. Có setup checklist đủ để team tạo project.
12. Có file skeleton cần tạo.
13. Có acceptance criteria rõ.
14. Có đầu vào cho FRONTEND-02.

---

## 39. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Chọn stack nhưng không chốt convention | Code mỗi người một kiểu | FRONTEND-01 chốt folder, naming, state, API pattern |
| Hard-code theo role | Sai quyền khi role thay đổi | Dựa permission + data scope + allowed_actions |
| API client không chuẩn | Mỗi module xử lý lỗi khác nhau | Dùng api-client chung và error mapper chung |
| Layout code lặp lại | Khó bảo trì | Dùng ModuleWorkspaceLayout reusable |
| Component thiếu chuẩn | UI không nhất quán | FRONTEND-02 triển khai Design System trước màn hình |
| Backend chưa sẵn API | Frontend bị chờ | Dùng mock API theo API-01 contract |
| Permission backend/frontend lệch | Lộ hoặc thiếu UI | QA test route/menu/action theo permission matrix |
| Token storage chưa an toàn | Rủi ro bảo mật | Ưu tiên HttpOnly cookie hoặc memory strategy |
| Dashboard gọi quá nhiều API | Chậm | Lazy load widget, cache, invalidate theo event |
| Responsive làm sau | Vỡ mobile P0 | Chốt mobile priority ngay từ FRONTEND-01 |

---

## 40. Roadmap sau FRONTEND-01

Sau khi chốt FRONTEND-01, tiếp tục triển khai:

```text
FRONTEND-02: Design System Implementation
```

FRONTEND-02 cần tập trung:

1. Token CSS.
2. Theme foundation.
3. Button/Input/Select/DatePicker.
4. DataTable base.
5. Modal/Drawer/Toast/Alert.
6. Empty/Error/Loading/Forbidden state.
7. PermissionGate/MaskedField.
8. Storybook structure.
9. Component QA checklist.

Sau FRONTEND-02 mới nên đi sâu vào:

```text
FRONTEND-03: Routing, Auth Guard & Permission Framework
FRONTEND-04: API Client, Query Layer & Error Handling
FRONTEND-05: Layout Implementation (Home Portal, App Switcher, Module Workspace)
```

---

## 41. Kết luận

FRONTEND-01 chốt rằng frontend của hệ thống phải được xây dựng như một nền tảng web app nhiều module, không phải tập hợp màn hình rời rạc.

Tư duy triển khai chính:

```text
Project setup chắc
-> Design System dùng chung
-> Auth/permission rõ
-> Route/menu/app registry theo metadata
-> Layout shell tái sử dụng
-> API client thống nhất
-> Module feature tách biệt
-> State/error/responsive/accessibility đầy đủ
-> QA test được theo flow và permission
```

Quyết định quan trọng nhất:

```text
Frontend hỗ trợ trải nghiệm và ẩn/hiện UI theo quyền.
Backend vẫn là nguồn kiểm soát cuối cùng cho authentication, permission, data scope và business rule.
```

---

# PHỤ LỤC A: Command setup nhanh

```bash
pnpm create next-app enterprise-management-web \
  --typescript \
  --eslint \
  --app \
  --src-dir \
  --tailwind \
  --import-alias "@/*"

cd enterprise-management-web

pnpm add @tanstack/react-query @tanstack/react-table
pnpm add react-hook-form zod @hookform/resolvers
pnpm add zustand
pnpm add clsx tailwind-merge class-variance-authority
pnpm add date-fns lucide-react uuid
pnpm add -D prettier eslint-config-prettier
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom
pnpm add -D playwright
pnpm add -D storybook @storybook/nextjs
```

---

# PHỤ LỤC B: `.env.example`

```env
VITE_APP_NAME="Enterprise Management System"
VITE_APP_ENV="local"
VITE_API_BASE_URL="http://localhost:3000/api/v1"
VITE_INTERNAL_BUILD_VERSION="0.1.0"
VITE_ENABLE_MOCK_API="false"
VITE_ENABLE_STORYBOOK="true"
VITE_ENABLE_DEBUG_PANEL="true"
```

---

# PHỤ LỤC C: Checklist tạo pull request đầu tiên

| Mã | Checklist | Trạng thái |
| --- | --- | --- |
| FE01-PR-001 | Project build thành công |  |
| FE01-PR-002 | Lint pass |  |
| FE01-PR-003 | Typecheck pass |  |
| FE01-PR-004 | Env example có đủ biến |  |
| FE01-PR-005 | AppProviders render không lỗi |  |
| FE01-PR-006 | `/login` render AuthLayout |  |
| FE01-PR-007 | `/home` protected placeholder |  |
| FE01-PR-008 | Một module route placeholder render ModuleWorkspaceLayout |  |
| FE01-PR-009 | Permission utility có unit test cơ bản |  |
| FE01-PR-010 | API client có mock/test cơ bản |  |
| FE01-PR-011 | README frontend setup có lệnh chạy local |  |

