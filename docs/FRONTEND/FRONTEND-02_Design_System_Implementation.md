> ⚠️ **ĐÍNH CHÍNH STACK (bắt buộc) — đọc trước:** Tài liệu này có thể còn nhắc Next.js/Prisma (lỗi thời). Stack đã CHỐT: **Vite + React 19 SPA + TanStack Router (KHÔNG Next.js)** · **Drizzle (KHÔNG Prisma)** · **Valkey** · **Vitest**. Các token an toàn đã thay inline; phần khái niệm lấy [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md) làm chuẩn.

# FRONTEND-02: DESIGN SYSTEM IMPLEMENTATION

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · **FRONTEND-02 Design System** · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Design System: UI-05](<../UI/UI-05_Design_System_Component_Library.md>) · [Kiến trúc FE: FRONTEND-01](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [Layout: FRONTEND-05](<FRONTEND-05_Layout_Implementation.md>) · [UI/UX Tổng quan: UI-01](<../UI/UI-01_UIUX_Design_Tong_Quan.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-02 |
| Tên tài liệu | Design System Implementation |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-02 mô tả cách triển khai **Design System** từ tài liệu UI/UX sang mã nguồn frontend.

Tài liệu này dùng để:

1. Chuyển các quyết định ở UI-05 thành code thật: design token, theme, component, layout, state và accessibility.
2. Chuẩn hóa cách xây dựng component reusable cho toàn bộ hệ thống.
3. Đảm bảo Home Portal, Module Workspace, App Switcher, Dashboard và các module nghiệp vụ dùng cùng một nền giao diện.
4. Giúp frontend tránh code trùng lặp giữa HR, ATT, LEAVE, TASK, NOTI, DASH, AUTH và SYSTEM.
5. Tạo nền tảng để triển khai các màn nghiệp vụ ở các bước FRONTEND tiếp theo.
6. Chuẩn hóa Storybook, test, QA checklist và quy trình nghiệm thu component.
7. Đảm bảo frontend hiển thị theo permission/data scope nhưng không tự thay thế backend guard.
8. Chuẩn bị khả năng mở rộng theme, dark mode, SaaS branding và module mới sau MVP.

---

## 3. Căn cứ triển khai

FRONTEND-02 bám theo các quyết định đã chốt:

1. Sau đăng nhập, user vào Home Portal trước.
2. Từ Home Portal, user chọn app/module để vào Module Workspace.
3. Trong mọi màn protected, user có thể mở App Switcher.
4. Module Workspace có Topbar chung và Sidebar riêng theo module.
5. App, menu, route, button, widget, badge và field hiển thị theo permission/data scope.
6. Frontend chỉ xử lý ẩn/hiện, disable, masked field và route guard ở tầng trải nghiệm; backend vẫn là lớp kiểm tra quyền cuối cùng.
7. Mọi màn P0/P1 phải dùng component chuẩn trong Design System.
8. Dashboard, Home Portal và App Switcher không xử lý nghiệp vụ gốc.
9. Notification deep link phải đi về module gốc để kiểm tra quyền và business rule.
10. Component cần có state đầy đủ: loading, empty, error, forbidden, disabled, validation, success, stale.

---

## 4. Vị trí FRONTEND-02 trong roadmap frontend

Bộ tài liệu frontend đề xuất:

| Mã | Tên tài liệu | Mục tiêu |
| --- | --- | --- |
| FRONTEND-01 | Frontend Architecture & Project Setup | Chốt stack, cấu trúc project, routing, auth shell, config, tooling |
| FRONTEND-02 | Design System Implementation | Token, theme, component foundation, Storybook, QA component |
| FRONTEND-03 | Routing, Auth Guard & Permission Framework | Protected route, app registry, sidebar registry, permission utilities |
| FRONTEND-04 | API Client, Query Layer & Error Handling | HTTP client, React Query, response/error contract, interceptor |
| FRONTEND-05 | Layout Implementation | AuthLayout, HomePortalLayout, ModuleWorkspaceLayout, Topbar, Sidebar, AppSwitcher |
| FRONTEND-06 | AUTH & Account Frontend | Login, forgot/reset, profile, users/roles/permissions |
| FRONTEND-07 | Dashboard Frontend | Role dashboards, widget grid, quick actions |
| FRONTEND-08 | HR Frontend | Employee, department, profile change, contract |
| FRONTEND-09 | Attendance Frontend | Today attendance, records, adjustment, remote, shifts/rules |
| FRONTEND-10 | Leave Frontend | Leave balance, request, approval, calendar, policy |
| FRONTEND-11 | Task Frontend | Project, task, Kanban, comment, checklist |
| FRONTEND-12 | Notification Frontend | Badge, dropdown, list, detail, config |
| FRONTEND-13 | System/Foundation Frontend | Settings, audit, files, module catalog |
| FRONTEND-14 | QA, Performance & Release Readiness | Test, performance, accessibility, deployment checklist |

FRONTEND-02 không triển khai toàn bộ màn nghiệp vụ. Tài liệu này chỉ tạo nền component để các bước sau dùng lại.

---

## 5. Giả định stack kỹ thuật

Stack chính đã được FRONTEND-01 §8 chốt: **Next.js App Router + React + TypeScript** và **Tailwind CSS + CSS variables**. FRONTEND-02 bám theo quyết định này:

| Nhóm | Đề xuất |
| --- | --- |
| Framework | React + TypeScript |
| Build/App framework | Next.js App Router (đã chốt ở FRONTEND-01 §8) |
| Styling | Tailwind CSS + CSS variables (đã chốt ở FRONTEND-01 §8) |
| Component variant | class-variance-authority hoặc helper tương đương |
| Utility class merge | clsx + tailwind-merge |
| Form | React Hook Form + Zod |
| Data fetching | TanStack Query |
| Table | TanStack Table |
| Storybook | Storybook React |
| Test component | Vitest + React Testing Library |
| E2E/visual | Playwright; Chromatic/Loki nếu có Storybook cloud |
| Icon | Lucide React hoặc bộ SVG nội bộ |
| Date | date-fns hoặc dayjs |
| Accessibility check | axe-core, eslint-plugin-jsx-a11y |

Nguyên tắc quan trọng: Design System không được phụ thuộc vào business API. Component foundation phải dùng được cả khi chưa có backend.

---

## 6. Phạm vi triển khai FRONTEND-02

### 6.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Token | Primitive token, semantic token, component token |
| Theme | Light theme, dark-ready theme, CSS variable mapping |
| Styling foundation | Tailwind config, global CSS, reset/base style |
| Component primitive | Button, Input, PasswordInput, Textarea, Select, MultiSelect, Checkbox, Radio, Switch, Badge, Card |
| Form nâng cao | DatePicker, DateRangePicker, TimePicker, Upload/FileDropzone |
| Feedback | Alert, Toast, Modal, ConfirmDialog, Drawer, Tooltip, Skeleton, Spinner |
| Data display | DataTable foundation, Avatar, Tag, Timeline, DetailSection |
| Navigation | Breadcrumb, Tabs, SidebarItem, AppCard, AvatarMenu, CategoryChip |
| Permission UI | PermissionGate, ForbiddenState, DisabledActionTooltip, MaskedField |
| Layout component foundation | AuthLayout shell, HomePortalLayout shell, ModuleWorkspaceLayout shell placeholder |
| Domain starter | AttendanceStatusCard, LeaveBalanceCard, TaskCard, EmployeeProfileHeader skeleton |
| Storybook | Component story structure, state stories, accessibility stories |
| Test | Unit test, interaction test, accessibility test checklist |
| Documentation | Component API, props convention, naming, acceptance criteria |

### 6.2 Không bao gồm

| Nội dung | Chuyển sang |
| --- | --- |
| Route guard hoàn chỉnh | FRONTEND-03 |
| API client chuẩn hóa toàn hệ thống | FRONTEND-04 |
| Home Portal/App Switcher hoàn chỉnh | FRONTEND-05 |
| Dashboard widget tích hợp API | FRONTEND-07 |
| HR/ATT/LEAVE/TASK/NOTI screen hoàn chỉnh | FRONTEND-08 -> FRONTEND-12 |
| Business workflow logic | Module frontend tương ứng |
| Backend permission enforcement | Backend/API |
| Nhóm component `workflow/` (ApprovalBox, StatusStepper, CommentThread, Checklist, AssigneePicker) | FRONTEND-08 -> FRONTEND-12 (module frontend) |
| Nhóm component `dashboard/` (MetricCard, WidgetCard, QuickActionCard, ListWidget, ChartPlaceholder) | FRONTEND-07 |

Ghi chú: hai nhóm `workflow/` và `dashboard/` được giữ chỗ (placeholder) trong cây thư mục ở mục 8 nhưng chưa được đặc tả (variant/state) ở FRONTEND-02. Chúng được đánh dấu "Không bao gồm (sẽ làm ở tài liệu sau)" để cây thư mục và phạm vi nhất quán.

---

## 7. Nguyên tắc triển khai Design System

### 7.1 Component trước, màn hình sau

Không code trực tiếp UI vào từng màn nghiệp vụ nếu pattern có thể tái sử dụng.

Ví dụ:

```text
Sai:
HR tự code một nút riêng
LEAVE tự code một nút riêng
TASK tự code một nút riêng

Đúng:
Dùng Button từ Design System
Chỉ truyền variant, size, loading, disabledReason
```

### 7.2 Token trước, CSS cụ thể sau

Không hard-code trực tiếp màu, radius, shadow trong component.

```tsx
// Không khuyến nghị
<div className="bg-[#2F80ED] rounded-[8px]" />

// Khuyến nghị
<div className="bg-action-primary rounded-md" />
```

### 7.3 Component phải có state

Mỗi component quan trọng cần có tối thiểu (đồng bộ với mục 3.10 và bộ state bắt buộc của UI-05 §5.2):

1. Default.
2. Hover.
3. Focus visible.
4. Disabled.
5. Loading nếu có action.
6. Error/validation nếu có validation.
7. Empty nếu là container/list.
8. Permission/forbidden nếu liên quan action hoặc route.
9. Success nếu có action có phản hồi thành công.
10. Stale nếu dữ liệu được cache (dashboard/widget, notification count).

### 7.4 Không hard-code role

Không viết:

```ts
if (user.role === 'HR') showButton()
```

Phải viết:

```ts
if (can('HR.EMPLOYEE.CREATE')) showButton()
```

Role chỉ là seed. Permission và data scope mới là cơ sở UI.

### 7.5 Backend là guard cuối cùng

Frontend cần ẩn/disable để UX tốt hơn, nhưng mọi action vẫn phải xử lý các lỗi backend:

| HTTP | UI cần xử lý |
| --- | --- |
| 401 | Refresh token hoặc redirect login |
| 403 | Forbidden state hoặc disabled action message |
| 404 | NotFound state |
| 409 | Conflict/business rule alert |
| 422 | Inline validation + error summary |
| 500 | ErrorState + retry + request_id |

---

## 8. Cấu trúc thư mục đề xuất

```text
src/
  app/
    providers/
      AppProviders.tsx
      ThemeProvider.tsx
      QueryProvider.tsx
    styles/
      globals.css
      tokens.css
      themes.css
  shared/
    design-system/
      tokens/
        primitive.ts
        semantic.ts
        component.ts
        index.ts
      theme/
        theme.types.ts
        theme.config.ts
        theme.utils.ts
      primitives/
        Button/
          Button.tsx
          Button.types.ts
          Button.test.tsx
          Button.stories.tsx
          index.ts
        Input/
        Select/
        Checkbox/
        Switch/
        Badge/
        Card/
      components/
        feedback/
          Alert/
          Toast/
          Modal/
          ConfirmDialog/
          Drawer/
          Tooltip/
          Skeleton/
          Spinner/
        data-display/
          DataTable/
          Avatar/
          Tag/
          Timeline/
          DetailSection/
        navigation/
          Breadcrumb/
          Tabs/
          SidebarItem/
          AppCard/
          AvatarMenu/
          CategoryChip/
        permission/
          PermissionGate/
          ForbiddenState/
          DisabledActionTooltip/
          MaskedField/
        workflow/                 # Placeholder - không bao gồm ở FRONTEND-02 (sẽ làm ở FRONTEND-08 -> FRONTEND-12)
          ApprovalBox/
          StatusStepper/
          CommentThread/
          Checklist/
          AssigneePicker/
        dashboard/                # Placeholder - không bao gồm ở FRONTEND-02 (sẽ làm ở FRONTEND-07)
          MetricCard/
          WidgetCard/
          QuickActionCard/
          ListWidget/
          ChartPlaceholder/
        domain/
          attendance/
            AttendanceStatusCard/
            CheckInOutButton/
          leave/
            LeaveBalanceCard/
            LeaveRequestSummary/
          task/
            TaskCard/
            KanbanColumn/
          hr/
            EmployeeProfileHeader/
      layout/
        AuthLayout/
        HomePortalLayout/
        ModuleWorkspaceLayout/
        Topbar/
        Sidebar/
        AppSwitcher/
      hooks/
        useDisclosure.ts
        useBreakpoint.ts
        useFocusTrap.ts
      utils/
        cn.ts
        a11y.ts
        status.ts
        format.ts
      index.ts
  modules/
    auth/
    dashboard/
    hr/
    attendance/
    leave/
    tasks/
    notifications/
    system/
  stories/
    Introduction.mdx
    DesignTokens.mdx
```

---

## 9. Quy ước export component

Mỗi component dùng barrel export rõ ràng:

```ts
// shared/design-system/primitives/Button/index.ts
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button.types';
```

Root export:

```ts
// shared/design-system/index.ts
export * from './primitives/Button';
export * from './primitives/Input';
export * from './components/feedback/Modal';
export * from './components/permission/PermissionGate';
```

Quy tắc:

1. Module nghiệp vụ chỉ import từ `shared/design-system`.
2. Không import sâu vào file nội bộ nếu không cần.
3. Không để component domain import ngược module nghiệp vụ.
4. Component foundation không gọi API.
5. Component domain được phép nhận data shape đã được chuẩn hóa qua props, nhưng không tự fetch API ở FRONTEND-02.

---

## 10. Design token implementation

### 10.1 Token layer

Design token chia thành 3 lớp:

```text
Primitive token
  -> màu gốc, spacing scale, radius scale, font scale

Semantic token
  -> màu nền, màu chữ, border, action, status

Component token
  -> token riêng cho Button, Table, Sidebar, AppCard...
```

### 10.2 Primitive token

```ts
export const primitiveTokens = {
  color: {
    gray: {
      50: '#F8FAFC',
      100: '#F1F5F9',
      200: '#E2E8F0',
      300: '#CBD5E1',
      400: '#94A3B8',
      500: '#64748B',
      600: '#475569',
      700: '#334155',
      800: '#1E293B',
      900: '#0F172A',
      950: '#020617',
    },
    brand: {
      50: '#EEF6FF',
      100: '#D9ECFF',
      200: '#B9DCFF',
      300: '#8BC5FF',
      400: '#58A8F7',
      500: '#2F80ED',
      600: '#1F6FD1',
      700: '#1759A8',
      800: '#164A86',
      900: '#143D6B',
    },
  },
  spacing: {
    0: '0px',
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
    16: '64px',
  },
  radius: {
    none: '0px',
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '24px',
    full: '999px',
  },
  fontSize: {
    // size / line-height theo UI-05 §8.2
    xs: ['12px', '16px'],
    sm: ['14px', '20px'],
    base: ['16px', '24px'],
    md: ['18px', '28px'],
    lg: ['20px', '30px'],
    xl: ['24px', '32px'],
    '2xl': ['30px', '38px'],
    '3xl': ['36px', '44px'],
  },
  fontWeight: {
    // theo UI-05 §8.3
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  fontFamily: {
    // theo UI-05 §8.1
    sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  shadow: {
    // theo UI-05 §10.3
    none: 'none',
    xs: '0 1px 2px rgba(15, 23, 42, 0.04)',
    sm: '0 1px 3px rgba(15, 23, 42, 0.08)',
    md: '0 4px 12px rgba(15, 23, 42, 0.10)',
    lg: '0 12px 32px rgba(15, 23, 42, 0.16)',
    xl: '0 20px 48px rgba(15, 23, 42, 0.20)',
    overlay: '0 24px 64px rgba(15, 23, 42, 0.24)',
  },
  zIndex: {
    // theo UI-05 §6.4
    base: 0,
    sticky: 100,
    header: 200,
    dropdown: 300,
    overlay: 400,
    modal: 500,
    toast: 600,
  },
  breakpoint: {
    // theo UI-05 §9.4
    mobile: '0px',
    tablet: '768px',
    laptop: '1024px',
    desktop: '1200px',
    wide: '1440px',
  },
  motion: {
    // duration theo UI-05 §11.1
    duration: {
      fast: '120ms',
      normal: '180ms',
      slow: '240ms',
      feedback: '300ms',
    },
    // easing theo UI-05 §11.2
    easing: {
      standard: 'cubic-bezier(0.2, 0, 0, 1)',
      enter: 'cubic-bezier(0, 0, 0.2, 1)',
      exit: 'cubic-bezier(0.4, 0, 1, 1)',
    },
  },
  layout: {
    // theo UI-05 §28.1
    topbarHeight: '64px',
    sidebarWidth: '260px',
    sidebarCollapsedWidth: '72px',
  },
} as const;
```

### 10.3 Semantic token

```ts
export const semanticTokens = {
  light: {
    color: {
      bg: {
        canvas: 'var(--gray-50)',
        surface: '#FFFFFF',
        subtle: 'var(--gray-100)',
      },
      text: {
        primary: 'var(--gray-900)',
        secondary: 'var(--gray-600)',
        muted: 'var(--gray-500)',
        inverse: '#FFFFFF',
      },
      border: {
        default: 'var(--gray-200)',
        strong: 'var(--gray-300)',
      },
      action: {
        primary: 'var(--brand-500)',
        primaryHover: 'var(--brand-600)',
        primaryPressed: 'var(--brand-700)',
      },
      status: {
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
        neutral: '#64748B',
      },
    },
  },
  dark: {
    // mapping theo UI-05 §7.5 (Dark mode value đề xuất)
    color: {
      bg: {
        canvas: 'var(--gray-950)',
        surface: 'var(--gray-900)',
        subtle: 'var(--gray-800)',
      },
      text: {
        primary: 'var(--gray-50)',
        secondary: 'var(--gray-300)',
        muted: 'var(--gray-400)',
        inverse: 'var(--gray-900)',
      },
      border: {
        default: 'var(--gray-700)',
        strong: 'var(--gray-600)',
      },
      action: {
        primary: 'var(--brand-400)',
        primaryHover: 'var(--brand-300)',
        primaryPressed: 'var(--brand-200)',
      },
      status: {
        success: '#34D399',
        warning: '#FBBF24',
        danger: '#F87171',
        info: '#60A5FA',
        neutral: 'var(--gray-300)',
      },
    },
  },
} as const;
```

### 10.4 CSS variable output

```css
:root {
  --gray-50: #F8FAFC;
  --gray-100: #F1F5F9;
  --gray-200: #E2E8F0;
  --gray-300: #CBD5E1;
  --gray-400: #94A3B8;
  --gray-500: #64748B;
  --gray-600: #475569;
  --gray-700: #334155;
  --gray-800: #1E293B;
  --gray-900: #0F172A;
  --gray-950: #020617;

  --brand-50: #EEF6FF;
  --brand-100: #D9ECFF;
  --brand-200: #B9DCFF;
  --brand-300: #8BC5FF;
  --brand-400: #58A8F7;
  --brand-500: #2F80ED;
  --brand-600: #1F6FD1;
  --brand-700: #1759A8;
  --brand-800: #164A86;
  --brand-900: #143D6B;

  --color-bg-canvas: var(--gray-50);
  --color-bg-surface: #FFFFFF;
  --color-bg-subtle: var(--gray-100);

  --color-text-primary: var(--gray-900);
  --color-text-secondary: var(--gray-600);
  --color-text-muted: var(--gray-500);
  --color-text-inverse: #FFFFFF;

  --color-border-default: var(--gray-200);
  --color-border-strong: var(--gray-300);

  --color-action-primary: var(--brand-500);
  --color-action-primary-hover: var(--brand-600);
  --color-action-primary-pressed: var(--brand-700);
  --color-focus-ring: var(--brand-300);

  --color-status-success: #10B981;
  --color-status-warning: #F59E0B;
  --color-status-danger: #EF4444;
  --color-status-info: #3B82F6;
  --color-status-neutral: #64748B;

  --radius-none: 0px;
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 24px;
  --radius-full: 999px;

  /* Shadow scale theo UI-05 §10.3 */
  --shadow-none: none;
  --shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.08);
  --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.10);
  --shadow-lg: 0 12px 32px rgba(15, 23, 42, 0.16);
  --shadow-xl: 0 20px 48px rgba(15, 23, 42, 0.20);
  --shadow-overlay: 0 24px 64px rgba(15, 23, 42, 0.24);

  /* Named shadow alias theo UI-05 §28.1 */
  --shadow-card: var(--shadow-sm);
  --shadow-dropdown: var(--shadow-md);
  --shadow-modal: var(--shadow-lg);

  /* Typography theo UI-05 §8 */
  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 16px;
  --font-size-md: 18px;
  --font-size-lg: 20px;
  --font-size-xl: 24px;
  --font-size-2xl: 30px;
  --font-size-3xl: 36px;

  --line-height-xs: 16px;
  --line-height-sm: 20px;
  --line-height-base: 24px;
  --line-height-md: 28px;
  --line-height-lg: 30px;
  --line-height-xl: 32px;
  --line-height-2xl: 38px;
  --line-height-3xl: 44px;

  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Z-index scale theo UI-05 §6.4 */
  --z-base: 0;
  --z-sticky: 100;
  --z-header: 200;
  --z-dropdown: 300;
  --z-overlay: 400;
  --z-modal: 500;
  --z-toast: 600;

  /* Breakpoint theo UI-05 §9.4 */
  --bp-mobile: 0px;
  --bp-tablet: 768px;
  --bp-laptop: 1024px;
  --bp-desktop: 1200px;
  --bp-wide: 1440px;

  /* Motion theo UI-05 §11 */
  --motion-fast: 120ms;
  --motion-normal: 180ms;
  --motion-slow: 240ms;
  --motion-feedback: 300ms;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0, 0, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);

  /* Layout vars theo UI-05 §28.1 */
  --topbar-height: 64px;
  --sidebar-width: 260px;
  --sidebar-collapsed-width: 72px;
}

[data-theme='dark'] {
  /* mapping theo UI-05 §7.5 — darkest background dùng token var, không hard-code hex */
  --color-bg-canvas: var(--gray-950);
  --color-bg-surface: var(--gray-900);
  --color-bg-subtle: var(--gray-800);

  --color-text-primary: var(--gray-50);
  --color-text-secondary: var(--gray-300);
  --color-text-muted: var(--gray-400);
  --color-text-inverse: var(--gray-900);

  --color-border-default: var(--gray-700);
  --color-border-strong: var(--gray-600);

  --color-action-primary: var(--brand-400);
  --color-action-primary-hover: var(--brand-300);
  --color-action-primary-pressed: var(--brand-200);
  --color-focus-ring: var(--brand-400);

  --color-status-success: #34D399;
  --color-status-warning: #FBBF24;
  --color-status-danger: #F87171;
  --color-status-info: #60A5FA;
  --color-status-neutral: var(--gray-300);
}
```

### 10.5 Tailwind mapping

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        canvas: 'var(--color-bg-canvas)',
        surface: 'var(--color-bg-surface)',
        subtle: 'var(--color-bg-subtle)',
        primary: 'var(--color-action-primary)',
        'primary-hover': 'var(--color-action-primary-hover)',
        'primary-pressed': 'var(--color-action-primary-pressed)',
        border: 'var(--color-border-default)',
        'border-strong': 'var(--color-border-strong)',
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          inverse: 'var(--color-text-inverse)',
        },
        status: {
          success: 'var(--color-status-success)',
          warning: 'var(--color-status-warning)',
          danger: 'var(--color-status-danger)',
          info: 'var(--color-status-info)',
          neutral: 'var(--color-status-neutral)',
        },
      },
      borderRadius: {
        none: 'var(--radius-none)',
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        none: 'var(--shadow-none)',
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        overlay: 'var(--shadow-overlay)',
        card: 'var(--shadow-card)',
        dropdown: 'var(--shadow-dropdown)',
        modal: 'var(--shadow-modal)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        xs: ['var(--font-size-xs)', { lineHeight: 'var(--line-height-xs)' }],
        sm: ['var(--font-size-sm)', { lineHeight: 'var(--line-height-sm)' }],
        base: ['var(--font-size-base)', { lineHeight: 'var(--line-height-base)' }],
        md: ['var(--font-size-md)', { lineHeight: 'var(--line-height-md)' }],
        lg: ['var(--font-size-lg)', { lineHeight: 'var(--line-height-lg)' }],
        xl: ['var(--font-size-xl)', { lineHeight: 'var(--line-height-xl)' }],
        '2xl': ['var(--font-size-2xl)', { lineHeight: 'var(--line-height-2xl)' }],
        '3xl': ['var(--font-size-3xl)', { lineHeight: 'var(--line-height-3xl)' }],
      },
      fontWeight: {
        regular: 'var(--font-weight-regular)',
        medium: 'var(--font-weight-medium)',
        semibold: 'var(--font-weight-semibold)',
        bold: 'var(--font-weight-bold)',
      },
      zIndex: {
        base: 'var(--z-base)',
        sticky: 'var(--z-sticky)',
        header: 'var(--z-header)',
        dropdown: 'var(--z-dropdown)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
      },
      screens: {
        // theo UI-05 §9.4
        tablet: '768px',
        laptop: '1024px',
        desktop: '1200px',
        wide: '1440px',
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        normal: 'var(--motion-normal)',
        slow: 'var(--motion-slow)',
        feedback: 'var(--motion-feedback)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        enter: 'var(--ease-enter)',
        exit: 'var(--ease-exit)',
      },
      spacing: {
        topbar: 'var(--topbar-height)',
        sidebar: 'var(--sidebar-width)',
        'sidebar-collapsed': 'var(--sidebar-collapsed-width)',
      },
    },
  },
};
```

---

## 11. Theme provider

### 11.1 Theme mode

MVP cần chuẩn bị:

| Mode | Mức độ |
| --- | --- |
| Light | Bắt buộc |
| Dark | Có token và provider, có thể chưa tối ưu toàn bộ screen |
| System | Khuyến nghị |
| Company brand override | Phase sau |

### 11.2 Theme provider interface

```ts
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
}
```

### 11.3 Quy tắc lưu theme

| Nguồn | Ưu tiên |
| --- | --- |
| User setting từ API | Cao nhất nếu có |
| Local storage | Dùng khi chưa có API |
| System preference | Fallback |
| Light | Default cuối |

---

## 12. Styling utility

### 12.1 `cn` utility

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 12.2 Variant pattern

```ts
import { cva, type VariantProps } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      // variant theo UI-05 §16.1
      variant: {
        primary: 'bg-primary text-white hover:bg-primary-hover',
        secondary: 'bg-surface text-primary border border-border hover:bg-subtle',
        ghost: 'bg-transparent text-primary hover:bg-subtle',
        danger: 'bg-status-danger text-white hover:opacity-90',
        success: 'bg-status-success text-white hover:opacity-90',
        link: 'bg-transparent text-primary underline-offset-4 hover:underline',
      },
      // size theo UI-05 §16.2: xs 28px, sm 32px, md 40px, lg 48px
      size: {
        xs: 'h-7 px-2.5',
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-12 px-5',
        icon: 'h-10 w-10',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);
```

---

## 13. Component API convention

### 13.1 Common props

Mỗi component tương tác nên hỗ trợ:

```ts
interface BaseComponentProps {
  className?: string;
  id?: string;
  'data-testid'?: string;
}
```

Component action nên hỗ trợ:

```ts
interface ActionStateProps {
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}
```

Component permission-aware nên hỗ trợ:

```ts
interface PermissionAwareProps {
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: string[];
  hideWhenNoPermission?: boolean;
  disabledWhenNoPermission?: boolean;
}
```

### 13.2 Naming convention

| Loại | Quy ước |
| --- | --- |
| Component | PascalCase: `Button`, `DataTable`, `PermissionGate` |
| Hook | camelCase bắt đầu bằng use: `useDisclosure` |
| Type | PascalCase + suffix: `ButtonProps`, `RouteMeta` |
| File | Component chính cùng tên component: `Button.tsx` |
| Story | `Button.stories.tsx` |
| Test | `Button.test.tsx` |
| CSS module nếu có | Hạn chế; ưu tiên Tailwind/CSS variables |

---

## 14. Component foundation P0

### 14.1 Button

#### Mục tiêu

Button là action primitive dùng toàn hệ thống.

#### Props

```ts
// Variant theo UI-05 §16.1 (ghost = Tertiary/Ghost; icon-only dùng size 'icon')
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'link';

// Size theo UI-05 §16.2 (xs 28px, sm 32px, md 40px, lg 48px); 'icon' cho nút icon-only
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  disabledReason?: string;
}
```

#### State bắt buộc

| State | Yêu cầu |
| --- | --- |
| Default | Hiển thị đúng variant |
| Hover | Có transition nhẹ |
| Focus visible | Có focus ring rõ |
| Active | Pressed state |
| Disabled | Không click được, vẫn đọc được |
| Loading | Có spinner, chống double submit |
| Disabled reason | Tooltip hoặc title nếu có lý do |

#### Storybook stories

```text
Button/Primary
Button/Secondary
Button/Ghost
Button/Danger
Button/WithIcon
Button/Loading
Button/DisabledWithReason
Button/FullWidth
```

---

### 14.2 Input

#### Props

```ts
export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  requiredMark?: boolean;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
}
```

#### Quy tắc

1. Label luôn liên kết với input qua `htmlFor`.
2. Error dùng `aria-invalid`.
3. Helper/error có `aria-describedby`.
4. Placeholder không thay thế label.
5. Required field cần có dấu hiệu rõ.

---

### 14.3 PasswordInput

Dùng cho login, reset password, change password (theo UI-05 §24.1 PasswordField).

#### Props

```ts
export interface PasswordInputProps
  extends Omit<InputProps, 'type'> {
  showToggle?: boolean;
  showStrength?: boolean;
}
```

#### Quy tắc

1. Có nút show/hide để hiện/ẩn mật khẩu, mặc định ẩn (`type="password"`).
2. Nút toggle là icon button, có `aria-label` và `aria-pressed`.
3. Strength meter là optional, chỉ bật khi `showStrength`.
4. Kế thừa state label/error/helper/disabled/readonly từ Input.

---

### 14.4 Select / Combobox / MultiSelect

MVP nên phân biệt:

| Component | Dùng khi |
| --- | --- |
| Select | Danh sách ngắn, không search |
| MultiSelect | Chọn nhiều: role, permission, assignee, watcher |
| Combobox | Danh sách dài, cần search employee/project/department |
| AsyncCombobox | Phase sau hoặc module-specific khi cần gọi API |

Combobox cho Employee/Assignee nên là domain component sau này, không đặt business logic trong primitive.

State bắt buộc (theo UI-05 §17.3): loading options, empty options, disabled, error, selected, clearable. MultiSelect hiển thị các lựa chọn đã chọn dưới dạng chip có nút xóa.

#### MultiSelect props

```ts
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  error?: string;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  searchable?: boolean;
}
```

---

### 14.5 Badge / StatusBadge

#### Badge primitive

```ts
type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'brand';
```

#### StatusBadge mapping

```ts
const statusVariantMap = {
  ACTIVE: 'success',
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  DRAFT: 'neutral',
  OVERDUE: 'danger',
  DONE: 'success',
  IN_PROGRESS: 'info',
} as const;
```

Quy tắc: trạng thái nghiệp vụ dùng semantic color, không dùng module accent.

---

### 14.6 Card

Card là container nền cho widget, form section, detail section.

Props đề xuất:

```ts
interface CardProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  loading?: boolean;
  children: React.ReactNode;
}
```

---

### 14.7 DatePicker / DateRangePicker / TimePicker

Theo UI-05 §17.4. Dùng cho ngày sinh/ngày vào làm/ngày nghỉ (DatePicker), kỳ nghỉ/filter bảng công/report (DateRangePicker), giờ check-in/out/nghỉ theo giờ/ca làm (TimePicker).

#### Props

```ts
export interface DatePickerProps {
  value?: string; // ISO date
  onChange: (value: string | undefined) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  minDate?: string;
  maxDate?: string;
  isDateDisabled?: (date: string) => boolean;
  disabledReason?: (date: string) => string | undefined;
}

export interface DateRangePickerProps {
  value?: { start?: string; end?: string };
  onChange: (value: { start?: string; end?: string }) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  showSelectedDays?: boolean;
}

export interface TimePickerProps {
  value?: string; // HH:mm
  onChange: (value: string | undefined) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  minuteStep?: number;
}
```

#### Quy tắc

1. Hiển thị format Việt Nam `DD/MM/YYYY`; API vẫn dùng ISO date/time.
2. DateRangePicker hiển thị số ngày được chọn nếu nghiệp vụ cần (`showSelectedDays`).
3. Ngày bị disabled phải có tooltip/lý do nếu có rule.
4. Component foundation không tự fetch business data; rule được truyền vào qua props.

---

### 14.8 Upload / FileDropzone

Theo UI-05 §17.6.

#### Props

```ts
export interface UploadFile {
  id: string;
  name: string;
  size: number;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  errorMessage?: string;
}

export interface FileDropzoneProps {
  files: UploadFile[];
  onSelectFiles: (files: File[]) => void;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  disabled?: boolean;
  canUpload?: boolean;
}
```

#### State bắt buộc

| State | UI behavior |
| --- | --- |
| Default | Dropzone dashed border, icon upload |
| Drag over | Border brand |
| Uploading | Progress bar |
| Success | File row + status |
| Error | File row danger + retry/remove |
| Forbidden | Ẩn nếu không có quyền upload (`canUpload === false`) |

---

## 15. Component feedback P0

### 15.1 Toast

Toast dùng cho phản hồi ngắn sau action.

| Loại | Dùng cho |
| --- | --- |
| Success | Tạo/cập nhật thành công |
| Error | Lỗi không cần inline |
| Warning | Cảnh báo nhẹ |
| Info | Thông tin hệ thống |

Quy tắc:

1. Không dùng toast làm nơi duy nhất hiển thị lỗi validation.
2. Lỗi 409/422 cần hiển thị tại form/card liên quan.
3. Toast cần auto-dismiss nhưng user có thể đóng.
4. Toast lỗi nên có `request_id` nếu backend trả về.

### 15.2 Alert

Alert dùng cho lỗi hoặc cảnh báo trong ngữ cảnh màn hình.

Ví dụ:

```text
Bạn đã có đơn nghỉ phép được duyệt trong hôm nay. Chấm công bị tạm khóa.
```

### 15.3 Modal

Dùng cho confirm hoặc form nhỏ.

Quy tắc:

1. Có focus trap.
2. Esc đóng nếu không nguy hiểm.
3. Click overlay đóng nếu không có dirty form.
4. Confirm destructive action cần nút danger.
5. Mobile có thể fullscreen hoặc bottom sheet tùy nội dung.

### 15.4 ConfirmDialog

Dùng cho action quan trọng:

| Action | Confirm |
| --- | --- |
| Xóa mềm nhân viên | Bắt buộc |
| Từ chối đơn nghỉ | Bắt buộc nhập lý do |
| Duyệt đơn nghỉ | Bắt buộc confirm |
| Khóa user | Bắt buộc |
| Rời form dirty | Bắt buộc |

### 15.5 Drawer

Drawer dùng cho detail nhanh hoặc form phụ.

MVP dùng drawer cho:

1. Task detail.
2. Employee quick detail.
3. Leave request detail.
4. Notification detail nếu không vào page riêng.
5. Filter nâng cao.

---

## 16. Data display component

### 16.1 DataTable foundation

DataTable là component P0 vì HR, ATT, LEAVE, TASK, NOTI đều dùng bảng.

#### Feature MVP

| Feature | Bắt buộc |
| --- | --- |
| Column config | Có |
| Server pagination | Có |
| Sort indicator | Có |
| Row action | Có |
| Loading skeleton | Có |
| Empty state | Có |
| Error state | Có |
| Row selection | Nên có |
| Column visibility | Phase sau |
| Resize column | Phase sau |
| Virtualization | Phase sau nếu dữ liệu lớn |

#### Props đề xuất

```ts
export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  loading?: boolean;
  error?: Error | null;
  empty?: React.ReactNode;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
  };
  sorting?: {
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    onSortChange?: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
  };
  getRowId?: (row: TData) => string;
  onRowClick?: (row: TData) => void;
}
```

#### Responsive

| Viewport | Behavior |
| --- | --- |
| Desktop | Table đầy đủ |
| Tablet | Horizontal scroll hoặc ẩn cột phụ |
| Mobile | Chuyển thành card list nếu screen P0 |

### 16.2 EmptyState

EmptyState cần có:

1. Icon.
2. Title.
3. Description.
4. Primary action nếu phù hợp.
5. Secondary action nếu phù hợp.

Không dùng cùng một message chung cho mọi trường hợp. Empty do không có dữ liệu khác với empty do data scope.

### 16.3 ErrorState

ErrorState cần có:

1. Message dễ hiểu.
2. Retry action nếu có thể.
3. Request ID nếu backend trả.
4. Không lộ stack trace.
5. Không lộ dữ liệu nhạy cảm.

### 16.4 Navigation component contracts

Breadcrumb, Tabs và SidebarItem được nhắc tới ở phạm vi (mục 6.1) và sprint FE-DS-04 với yêu cầu "route-ready props". Phần này định nghĩa prop interface tối thiểu, giữ nhất quán với FRONTEND-05 (`PageHeaderConfig.breadcrumb` dùng key `href`, và `WorkspaceSidebarItem`).

#### Breadcrumb

Item breadcrumb dùng key `href` để khớp `PageHeaderConfig.breadcrumb` của FRONTEND-05.

```ts
export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
  maxItems?: number;
  className?: string;
}
```

#### Tabs

```ts
export interface TabItem {
  key: string;
  label: string;
  href?: string;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  activeKey: string;
  variant?: 'line' | 'pill' | 'vertical';
  onChange?: (key: string) => void;
  className?: string;
}
```

#### SidebarItem

Giữ tối thiểu và nhất quán với `WorkspaceSidebarItem` của FRONTEND-05 (key, label, path, icon, badge, children).

```ts
export interface SidebarItemProps {
  itemKey: string;
  label: string;
  path?: string;
  icon?: React.ReactNode;
  active?: boolean;
  collapsed?: boolean;
  badge?: React.ReactNode;
  isBeta?: boolean;
  isComingSoon?: boolean;
  children?: SidebarItemProps[];
  onSelect?: (itemKey: string) => void;
}
```

---

## 17. Permission component

### 17.1 PermissionGate

Signature chuẩn theo UI-05 §20.1, đồng bộ với cách FRONTEND-03 tiêu thụ (`requiredAnyPermissions`, `requiredScopes`):

```tsx
export interface PermissionGateProps {
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: string[];
  fallback?: React.ReactNode;
  mode?: 'hide' | 'disable' | 'readonly';
  children: React.ReactNode;
}
```

Ví dụ:

```tsx
<PermissionGate requiredPermissions={['HR.EMPLOYEE.CREATE']}>
  <Button>Tạo nhân viên</Button>
</PermissionGate>
```

### 17.2 DisabledActionTooltip

Dùng khi user có quyền xem nhưng business rule không cho thao tác.

```tsx
<DisabledActionTooltip reason="Đơn nghỉ đã được xử lý">
  <Button disabled>Duyệt</Button>
</DisabledActionTooltip>
```

### 17.3 MaskedField

Dùng cho dữ liệu nhạy cảm.

```tsx
<MaskedField
  value={employee.personalIdNumber}
  canView={can('HR.EMPLOYEE.VIEW_SENSITIVE')}
  mask="••••••••"
/>
```

### 17.4 ForbiddenState

Dùng cho:

1. Route thiếu quyền.
2. Widget thiếu quyền nhưng vẫn cần placeholder.
3. Deep link notification không còn quyền truy cập.

ForbiddenState không được hiển thị dữ liệu target.

---

## 18. Layout foundation

### 18.1 AuthLayout

Dùng cho:

1. Login.
2. Forgot password.
3. Reset password.

Props:

```ts
interface AuthLayoutProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}
```

### 18.2 HomePortalLayout

Dùng cho Home Portal.

Props:

```ts
interface HomePortalLayoutProps {
  header?: React.ReactNode;
  search?: React.ReactNode;
  children: React.ReactNode;
}
```

### 18.3 ModuleWorkspaceLayout

Dùng cho mọi module.

Props:

```ts
interface ModuleWorkspaceLayoutProps {
  moduleCode: ModuleCode;
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
}
```

### 18.4 WorkspacePage

Page shell tái sử dụng.

```ts
interface WorkspacePageProps {
  title: string;
  description?: string;
  // key `href` để khớp FRONTEND-05 PageHeaderConfig.breadcrumb
  breadcrumb?: Array<{ label: string; href?: string }>;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  toolbar?: React.ReactNode;
  alert?: React.ReactNode;
  children: React.ReactNode;
}
```

---

## 19. Domain starter components

Các domain component ở FRONTEND-02 chỉ là skeleton dùng props, chưa gọi API trực tiếp.

### 19.1 AttendanceStatusCard

Mục tiêu: hiển thị trạng thái chấm công hôm nay.

Props:

```ts
interface AttendanceStatusCardProps {
  status: 'not_checked_in' | 'checked_in' | 'checked_out' | 'blocked' | 'remote_auto';
  checkInTime?: string;
  checkOutTime?: string;
  message?: string;
  actions?: React.ReactNode;
  loading?: boolean;
}
```

### 19.2 CheckInOutButton

Props:

```ts
interface CheckInOutButtonProps {
  action: 'check-in' | 'check-out';
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}
```

### 19.3 LeaveBalanceCard

Props:

```ts
interface LeaveBalanceCardProps {
  leaveTypeName: string;
  remainingDays: number;
  usedDays?: number;
  pendingDays?: number;
  unit?: 'day' | 'hour';
}
```

### 19.4 TaskCard

Props:

```ts
interface TaskCardProps {
  title: string;
  code?: string;
  status: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  assignees?: Array<{ id: string; name: string; avatarUrl?: string }>;
  overdue?: boolean;
  onClick?: () => void;
}
```

### 19.5 EmployeeProfileHeader

Props:

```ts
interface EmployeeProfileHeaderProps {
  fullName: string;
  employeeCode: string;
  avatarUrl?: string;
  departmentName?: string;
  positionName?: string;
  employmentStatus?: string;
  actions?: React.ReactNode;
}
```

---

## 20. Icon system

### 20.1 Icon source

MVP có thể dùng Lucide React hoặc SVG nội bộ. Quy tắc:

1. Icon phải đồng nhất stroke width.
2. Icon có `aria-hidden` nếu chỉ trang trí.
3. Icon button phải có `aria-label`.
4. Module icon có thể dùng màu accent.
5. Action icon không dùng màu semantic nếu không phải trạng thái.

### 20.2 Module icon mapping

```ts
export const moduleIconMap = {
  DASH: 'LayoutDashboard',
  HR: 'Users',
  ATT: 'Clock',
  LEAVE: 'CalendarDays',
  TASK: 'ClipboardList',
  NOTI: 'Bell',
  AUTH: 'Shield',
  SYSTEM: 'Settings',
} as const;
```

---

## 21. Form foundation

### 21.1 Form stack

MVP dùng:

```text
React Hook Form
+ Zod schema
+ FormField component
+ Inline validation
+ Error summary
```

### 21.2 FormField pattern

```tsx
<FormField
  label="Họ và tên"
  required
  error={form.formState.errors.fullName?.message}
>
  <Input {...register('fullName')} />
</FormField>
```

### 21.3 Validation behavior

| Validation | UI |
| --- | --- |
| Required | Inline error |
| Format invalid | Inline error |
| Business conflict | Alert trong form |
| Server validation 422 | Map lỗi về field |
| Unknown server error | ErrorState hoặc toast error |
| Dirty form | Confirm khi rời route/app |

---

## 22. State design implementation

### 22.1 Loading

| Component | Loading behavior |
| --- | --- |
| Button | Spinner nhỏ, disable click |
| Card | Skeleton nội dung |
| Table | Skeleton row |
| Page | Page skeleton nếu initial load |
| Dropdown | Spinner + giữ kích thước tối thiểu |

### 22.2 Empty

Các loại empty:

| Loại | Ví dụ message |
| --- | --- |
| Empty data | Chưa có dữ liệu |
| Empty search | Không tìm thấy kết quả phù hợp |
| Empty scope | Bạn chưa có dữ liệu trong phạm vi được cấp |
| Empty permission | Bạn không có quyền xem nội dung này |
| Empty disabled module | Module hiện chưa được bật |

### 22.3 Error

Các loại error:

| Loại | UI |
| --- | --- |
| Network | Retry |
| 401 | Redirect login hoặc refresh |
| 403 | ForbiddenState |
| 404 | NotFoundState |
| 409 | Conflict alert |
| 422 | Form validation |
| 500 | ErrorState + request_id |

### 22.4 Stale data

Dùng cho dashboard/widget hoặc notification count nếu dữ liệu cache.

```text
Dữ liệu được cập nhật lúc 09:30. Bấm làm mới để tải dữ liệu mới nhất.
```

---

## 23. Accessibility requirement

### 23.1 Bắt buộc MVP

| Nhóm | Yêu cầu |
| --- | --- |
| Keyboard | Button, input, dropdown, modal, tabs dùng được bằng keyboard |
| Focus | Focus visible rõ |
| Modal | Focus trap, Esc close hợp lý |
| Form | Label liên kết input |
| Error | Error có `aria-describedby` |
| Icon button | Có `aria-label` |
| Color | Không truyền thông tin chỉ bằng màu |
| Contrast | Text/action đủ contrast |
| Toast | Có live region hợp lý |
| Data table | Header rõ, action có label |

### 23.2 Test accessibility

Dùng:

1. Storybook a11y addon.
2. `@axe-core/react` trong dev nếu cần.
3. React Testing Library kiểm tra label/role.
4. Playwright kiểm tra keyboard flow cho P0.

---

## 24. Storybook strategy

### 24.1 Cấu trúc Storybook

```text
Design System/
  Introduction
  Design Tokens
  Colors
  Typography
  Spacing
  Shadows
  Icons

Primitives/
  Button
  Input
  PasswordInput
  Textarea
  Select
  MultiSelect
  DatePicker
  DateRangePicker
  TimePicker
  Upload
  Checkbox
  Badge
  Card

Feedback/
  Alert
  Toast
  Modal
  Drawer
  ConfirmDialog
  Tooltip
  Skeleton

Navigation/
  AppCard
  Breadcrumb
  Tabs
  SidebarItem
  AvatarMenu

Data Display/
  DataTable
  Avatar
  Tag
  Timeline
  EmptyState
  ErrorState

Permission/
  PermissionGate
  MaskedField
  ForbiddenState
  DisabledActionTooltip

Domain/
  AttendanceStatusCard
  LeaveBalanceCard
  TaskCard
  EmployeeProfileHeader
```

### 24.2 Story state bắt buộc

Mỗi component P0 cần có:

1. Default.
2. All variants.
3. Loading.
4. Disabled.
5. Error nếu có.
6. Empty nếu có.
7. Mobile/responsive nếu layout.
8. Keyboard/focus example nếu interactive.
9. Permission state nếu liên quan.

### 24.3 Storybook acceptance

Một component chưa có Storybook state chính thì chưa được xem là ready để dùng trong màn nghiệp vụ.

---

## 25. Testing strategy

### 25.1 Unit/component test

Dùng Vitest + React Testing Library.

Test P0:

| Component | Test bắt buộc |
| --- | --- |
| Button | render, disabled, loading, click, icon |
| Input | label, error, disabled, aria |
| Modal | open/close, focus trap cơ bản |
| DataTable | loading, empty, row render, pagination callback |
| PermissionGate | show/hide/disable |
| MaskedField | mask/unmask |
| StatusBadge | mapping status đúng |
| Toast | show/dismiss |
| AppCard | locked/coming soon/default |

### 25.2 Visual regression

Nếu dùng Storybook:

1. Chụp baseline component P0.
2. Chạy visual diff khi thay đổi token/component.
3. Bắt buộc review khi thay đổi Button, Input, DataTable, Modal, Layout.

### 25.3 Accessibility test

1. Kiểm tra axe cho component P0.
2. Kiểm tra keyboard cho Modal, Dropdown, Tabs.
3. Kiểm tra label cho Form component.

---

## 26. Implementation roadmap

### Sprint FE-DS-01: Token, theme và base setup

| Việc | Output |
| --- | --- |
| Tạo token primitive/semantic/component | `tokens/*.ts` |
| Tạo CSS variables | `tokens.css`, `themes.css` |
| Cấu hình Tailwind mapping | `tailwind.config.ts` |
| Tạo ThemeProvider | Light/dark-ready |
| Tạo global styles | reset/base |
| Tạo `cn` utility | shared util |
| Tạo Storybook cơ bản | chạy được local |

Done khi:

1. App render được với theme token.
2. Storybook hiển thị token page.
3. Không hard-code màu chính trong component P0.

---

### Sprint FE-DS-02: Primitive components

| Component | Ưu tiên |
| --- | --- |
| Button | P0 |
| Input | P0 |
| PasswordInput | P0 |
| Textarea | P0 |
| Select | P0 |
| MultiSelect | P0 |
| DatePicker | P0 |
| DateRangePicker | P0 |
| TimePicker | P0 |
| Upload/FileDropzone | P0 |
| Checkbox | P0 |
| Radio | P1 |
| Switch | P1 |
| Badge/StatusBadge | P0 |
| Card | P0 |
| Avatar | P1 |
| Tooltip | P0 |

Done khi:

1. Có Storybook đầy đủ state.
2. Có test cơ bản.
3. Có accessibility rule cơ bản.

---

### Sprint FE-DS-03: Feedback, state và permission components

| Component | Ưu tiên |
| --- | --- |
| Alert | P0 |
| Toast | P0 |
| Modal | P0 |
| ConfirmDialog | P0 |
| Drawer | P0 |
| Skeleton | P0 |
| Spinner | P0 |
| EmptyState | P0 |
| ErrorState | P0 |
| ForbiddenState | P0 |
| PermissionGate | P0 |
| MaskedField | P0 |
| DisabledActionTooltip | P0 |

Done khi:

1. Form/action có thể dùng loading/error/permission state thống nhất.
2. Modal/drawer dùng được keyboard.
3. Permission UI không hard-code role.

---

### Sprint FE-DS-04: Data display và navigation foundation

| Component | Ưu tiên |
| --- | --- |
| DataTable | P0 |
| DetailSection | P0 |
| Timeline | P1 |
| Breadcrumb | P0 |
| Tabs | P0 |
| AppCard | P0 |
| SidebarItem | P0 |
| AvatarMenu | P1 |
| CategoryChip | P1 |

Done khi:

1. HR/ATT/LEAVE/TASK có thể dùng chung DataTable.
2. AppCard có default/locked/coming soon/badge/favorite state.
3. Breadcrumb/Tabs/SidebarItem có route-ready props.

---

### Sprint FE-DS-05: Layout shell và domain starter

| Component | Ưu tiên |
| --- | --- |
| AuthLayout | P0 |
| HomePortalLayout shell | P0 |
| ModuleWorkspaceLayout shell | P0 |
| Topbar shell | P0 |
| Sidebar shell | P0 |
| AppSwitcher shell | P0 |
| AttendanceStatusCard | P0 |
| CheckInOutButton | P0 |
| LeaveBalanceCard | P0 |
| TaskCard | P0 |
| EmployeeProfileHeader | P0 |

Done khi:

1. Có thể dựng skeleton Login, Home, Workspace.
2. Có thể demo P0 component domain trong Storybook.
3. Chưa cần API thật, dùng mock props.

---

## 27. Quality gate trước khi dùng component vào màn nghiệp vụ

Một component được phép dùng vào màn thật khi đạt:

| Mã | Tiêu chí |
| --- | --- |
| DS-QG-001 | Có file component + type rõ ràng |
| DS-QG-002 | Có Storybook story cho state chính |
| DS-QG-003 | Có test render cơ bản |
| DS-QG-004 | Có keyboard/focus behavior nếu interactive |
| DS-QG-005 | Có loading/disabled/error state nếu phù hợp |
| DS-QG-006 | Không hard-code màu ngoài token |
| DS-QG-007 | Không gọi API trực tiếp nếu là component foundation |
| DS-QG-008 | Không phụ thuộc module nghiệp vụ nếu ở shared foundation |
| DS-QG-009 | Có responsive behavior nếu là layout/data component |
| DS-QG-010 | Props không để lộ business implementation thừa |

---

## 28. Checklist pull request Design System

Mỗi PR component cần kiểm tra:

```text
[ ] Component đặt đúng thư mục
[ ] Props có type rõ ràng
[ ] Không hard-code màu/radius/shadow ngoài token
[ ] Có Storybook story
[ ] Có state loading/disabled/error nếu phù hợp
[ ] Có test render/callback chính
[ ] Có aria-label/role/keyboard nếu interactive
[ ] Không gọi API trong component foundation
[ ] Không hard-code role
[ ] Responsive không vỡ ở mobile
[ ] Screenshot/Storybook link được đính kèm trong PR
```

---

## 29. Definition of Done cho FRONTEND-02

FRONTEND-02 hoàn thành khi:

1. Token system đã được triển khai bằng CSS variables và map vào Tailwind/theme.
2. ThemeProvider chạy được, ít nhất hỗ trợ light theme và dark-ready.
3. Storybook chạy được và có trang Design Tokens.
4. Có primitive components P0: Button, Input, PasswordInput, Textarea, Select, MultiSelect, Badge, Card.
5. Có form nâng cao P0: DatePicker, DateRangePicker, TimePicker, Upload/FileDropzone.
6. Có feedback components P0: Toast, Alert, Modal, ConfirmDialog, Drawer, Skeleton, EmptyState, ErrorState.
7. Có permission components P0: PermissionGate, ForbiddenState, MaskedField, DisabledActionTooltip.
8. Có DataTable foundation đủ cho màn danh sách MVP.
9. Có layout shell foundation: AuthLayout, HomePortalLayout, ModuleWorkspaceLayout, Topbar, Sidebar, AppSwitcher.
10. Có domain starter components cho ATT, LEAVE, TASK, HR.
11. Component P0 có Storybook story và test cơ bản.
12. Không có component foundation nào gọi API trực tiếp.
13. Không hard-code role trong component.
14. Không hard-code màu chính ngoài token.
15. Có checklist QA component.
16. Đủ nền để triển khai FRONTEND-03, FRONTEND-04 và các màn nghiệp vụ.

---

## 30. Acceptance criteria FRONTEND-02

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| FE02-AC-001 | Có cấu trúc thư mục Design System rõ ràng trong `shared/design-system` |
| FE02-AC-002 | Có primitive token, semantic token, component token |
| FE02-AC-003 | CSS variables được inject toàn app |
| FE02-AC-004 | Tailwind config dùng token thay vì hard-code palette rời rạc |
| FE02-AC-005 | Button/Input/Badge/Card có đủ variant/state |
| FE02-AC-006 | Modal/Drawer/ConfirmDialog có keyboard/focus behavior cơ bản |
| FE02-AC-007 | DataTable hỗ trợ loading/empty/error/pagination/sort callback |
| FE02-AC-008 | EmptyState/ErrorState/ForbiddenState dùng chung toàn hệ thống |
| FE02-AC-009 | PermissionGate và MaskedField hoạt động theo permission utility/mock context |
| FE02-AC-010 | Layout shell có thể render Auth/Home/Workspace skeleton |
| FE02-AC-011 | AppCard có default, locked, coming soon, favorite, badge state |
| FE02-AC-012 | Domain starter components nhận props và không gọi API |
| FE02-AC-013 | Storybook có đủ nhóm component P0 |
| FE02-AC-014 | Component P0 có test cơ bản |
| FE02-AC-015 | Có checklist accessibility và responsive |
| FE02-AC-016 | Không có logic business rule phức tạp trong Design System |
| FE02-AC-017 | Không có hard-code role name trong component |
| FE02-AC-018 | Tài liệu đủ để frontend bắt đầu build screen nghiệp vụ bằng component chuẩn |

---

## 31. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Component làm quá sớm, quá phức tạp | Chậm MVP | Chỉ build P0/P1 trước, phase sau mở rộng |
| Token không map đúng với Figma | UI lệch thiết kế | Review token với UI/UX trước khi code screen |
| Không có Storybook | FE dùng component sai | Bắt buộc story cho component P0 |
| DataTable quá generic hoặc quá business | Khó dùng | Tách foundation DataTable và wrapper theo module |
| Permission hard-code theo role | Sai khi role thay đổi | Dùng permission utility/mock context |
| Component gọi API trực tiếp | Coupling cao | Foundation chỉ nhận props |
| Không test accessibility | Modal/dropdown khó dùng | Thêm a11y checklist và Storybook addon |
| Không có visual regression | Token đổi làm vỡ nhiều màn | Thêm baseline sau khi P0 component ổn định |
| Dark mode làm ngay quá sâu | Tốn thời gian | Chuẩn bị token/provider trước, tối ưu UI sau |
| Domain component phình to | Khó bảo trì | Domain starter chỉ nhận props, logic để module xử lý |

---

## 32. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE02-OQ-001 | ~~Stack chính là Vite React hay Next.js?~~ Đã chốt: **Next.js App Router** theo FRONTEND-01 §8. | Tech Lead | Đã chốt |
| FE02-OQ-002 | ~~Có dùng Tailwind bắt buộc hay dùng CSS module/theme object?~~ Đã chốt: **Tailwind CSS + CSS variables** theo FRONTEND-01 §8. | FE Lead | Đã chốt |
| FE02-OQ-003 | Có dùng shadcn/radix làm primitive nền không? | FE Lead | Trung bình |
| FE02-OQ-004 | Storybook có bắt buộc trong MVP không? | Product/FE Lead | Trung bình |
| FE02-OQ-005 | Có cần dark mode public trong MVP hay chỉ dark-ready? | Product/UI | Trung bình |
| FE02-OQ-006 | Token có export tự động từ Figma không? | UI/FE | Thấp |
| FE02-OQ-007 | Dùng icon library nào là chuẩn? | UI/FE | Trung bình |
| FE02-OQ-008 | Có visual regression ngay trong CI không? | DevOps/FE | Trung bình |
| FE02-OQ-009 | Permission context mock ở FE02 lấy từ đâu trước khi API thật sẵn sàng? | FE/BE | Cao |
| FE02-OQ-010 | Field-level permission sẽ do backend mask hay frontend mask? | BE/FE | Cao |

---

## 33. Kết luận

FRONTEND-02 là bước biến UI-05 thành nền code thật cho frontend.

Tư duy triển khai:

```text
Token chuẩn
-> Theme rõ
-> Component primitive ổn định
-> State/permission/accessibility thống nhất
-> Storybook test được
-> Layout shell sẵn sàng
-> Domain starter đủ dùng
-> Các module nghiệp vụ triển khai nhanh, ít trùng lặp
```

Sau FRONTEND-02, bước tiếp theo nên là:

```text
FRONTEND-03: Routing, Auth Guard & Permission Framework
```

FRONTEND-03 sẽ dùng các component và permission UI trong FRONTEND-02 để triển khai route registry, app registry, sidebar registry, protected route, permission guard và data scope utilities.
