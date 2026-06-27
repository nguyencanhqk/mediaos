# Micro-plan — S1-FE-LAYOUT-1 (FE shell: Home Portal + App Switcher + Module Workspace)

> Đội 1 (tech-lead + project-analyst). Nguồn: IMP02-STORY-094 · FRONTEND-05 · UI-06 · UI-07 · DECISIONS-02.
> READY: depends_on = S0-FE-CORE-1 (done). Builder = frontend-builder (FE-only, KHÔNG migration).

## Gap-analysis (reconcile-first)
- `apps/app/**` HIỆN KHÔNG TỒN TẠI (chỉ có apps/auth, apps/console, apps/api). Đây là WO net-new dựng
  vỏ nghiệp vụ hợp nhất `apps/app`.
- ⚠️ LỆCH: S0-FE-CORE-1 đánh dấu done với done_when "cấu trúc 3 app (auth·console·app)", NHƯNG apps/app
  chưa có package.json. Khớp ghi chú S0-CI-1 plan: entry "app" để-sẵn nhưng KHÔNG kích hoạt CI tới khi
  apps/app có package.json. ⇒ S1-FE-LAYOUT-1 PHẢI scaffold apps/app TRƯỚC khi dựng layout.
- Tái dùng MẠNH (KHÔNG viết lại): `@mediaos/ui` AppShell/AppSidebar/PageHeader/EmptyState/Skeleton;
  web-core nav helpers (navItemsGrouped/navItemsByCategory/NavItem), PermissionGate, useCan, api-client,
  auth store (useAuthStore/bootstrapSession/redirectToAuth), i18n. apps/console = pattern tham chiếu chính
  (main.tsx SSO boot · router · root-layout dùng AppShell).

## Invariants áp dụng
- FE KHÔNG hard-code permission/role → mọi ẩn/hiện app·menu·route qua useCan()/<PermissionGate> (web-core).
- Masking là việc của SERVER — FE chỉ render cái server trả. Layout không tự nới dữ liệu nhạy cảm.
- App inactive / thiếu setting / trái quyền → ẩn khỏi App Switcher + route guard → forbidden state.
- Dirty-form guard khi rời form chưa lưu (TanStack Router blocker).

## Decompose (lanes — paths KHÔNG chồng)
- L1 (frontend-builder) Scaffold apps/app: package.json (mirror @mediaos/console deps) · vite.config.ts ·
  vitest.config.ts · tsconfig.json · index.html · src/main.tsx (SSO boot giống console: bootstrapSession →
  redirectToAuth nếu chưa auth) · src/router.tsx (TanStack Router root) · src/i18n/** · src/index.css ·
  src/test/setup.ts · src/vite-env.d.ts.
    paths: apps/app/package.json, apps/app/vite.config.ts, apps/app/vitest.config.ts, apps/app/tsconfig.json,
           apps/app/index.html, apps/app/src/main.tsx, apps/app/src/router.tsx, apps/app/src/i18n/**,
           apps/app/src/index.css, apps/app/src/test/**, apps/app/src/vite-env.d.ts
- L2 (frontend-builder) web-core: app-registry types (AppEntry{id,labelKey,to,icon,module,permission,scope,
    status}) + selector lọc theo permission/active/setting; useDirtyFormGuard hook (router blocker).
    paths: packages/web-core/src/lib/app-registry.ts, packages/web-core/src/lib/app-registry.spec.ts,
           packages/web-core/src/hooks/use-dirty-form-guard.ts, packages/web-core/src/hooks/use-dirty-form-guard.spec.ts,
           packages/web-core/src/index.ts
- L3 (frontend-builder) @mediaos/ui layout primitives còn thiếu cho Home/Workspace: HomePortalLayout (header +
    app grid + recent/favorite slot rỗng), AppSwitcher (overlay/drawer + search + locked/coming-soon state),
    ModuleWorkspaceLayout (GlobalTopbar tái dùng + ModuleSidebar + MainContentShell), ForbiddenState/
    ModuleDisabledState nếu chưa có. KHÔNG sửa AppShell/AppSidebar hiện có (chỉ thêm file mới + export).
    paths: packages/ui/src/components/layout/home-portal-layout.tsx, packages/ui/src/components/layout/app-switcher.tsx,
           packages/ui/src/components/layout/module-workspace-layout.tsx, packages/ui/src/components/layout/*.spec.tsx,
           packages/ui/src/components/ui/forbidden-state.tsx, packages/ui/src/index.ts
- L4 (frontend-builder, depends L1+L2+L3) apps/app layouts + routes: AuthLayout-redirect guard,
    HomePortalLayout route ("/"), ModuleWorkspaceLayout route nhánh, app switcher mở từ topbar; gắn
    PermissionGate/useCan cho app visibility; loading/empty/error/forbidden state ở shell.
    paths: apps/app/src/routes/**, apps/app/src/layouts/**, apps/app/src/lib/apps.ts, apps/app/src/lib/nav.ts

## Thứ tự thi công
1. L1 scaffold apps/app (chạy/build/test được trước khi có layout).
2. L2 + L3 song song (web-core registry/guard ⟂ ui primitives — paths rời nhau).
3. L4 wiring routes/layouts (consumes L1–L3).

## Acceptance (Đội 3 đối chiếu — đo được)
- apps/app có package.json + `pnpm --filter @mediaos/app build` + `typecheck` XANH (done_when#1 + DoD).
- AuthLayout + HomePortalLayout + ModuleWorkspaceLayout (topbar/sidebar/app switcher) render responsive
  (UI-06/07); App Switcher có search + trạng thái locked/coming-soon (done_when#1).
- App/menu visibility theo permission qua useCan/PermissionGate — KHÔNG hard-code role; component test
  chứng minh user thiếu quyền → app/menu ẩn (done_when#2).
- Dirty-form guard chặn rời form chưa lưu (test mô phỏng blocker) (done_when#2).
- loading/empty/error/forbidden state hiện ở shell; `pnpm --filter @mediaos/app test` (+ web-core/ui) XANH
  (done_when#3).
- CI path-filter apps-frontend.yml kích hoạt nhánh "app" sau khi apps/app có package.json (đồng bộ S0-CI-1).

## Test tasks (Đội 2 viết — Đội 3 verify) — nguồn QA-05 (permission/scope FE) + FRONTEND-05 §testing
- web-core: app-registry selector — user CÓ quyền → app hiện; user THIẾU quyền/app inactive/thiếu setting
  → app bị lọc khỏi danh sách (deny-path).
- web-core: useDirtyFormGuard — form dirty → blocker chặn điều hướng; form sạch → cho đi.
- ui: AppSwitcher render app list + search filter; app locked/coming-soon hiển thị disabled (không click vào).
- apps/app: HomePortalLayout render app grid theo registry; PermissionGate ẩn app trái quyền (component test).
- apps/app: route guard — vào route trái quyền → forbidden state (KHÔNG render nội dung module).

## Out-of-scope (chống scope creep)
- Login/forgot/reset chi tiết → FRONTEND-06 (apps/auth). User/role admin CRUD → FRONTEND-13 (apps/console).
- Màn nghiệp vụ từng module (HR/ATT/LEAVE/TASK/DASH/NOTI) → FRONTEND-07..12. Global search thực → bước sau.
- KHÔNG đụng apps/api, apps/auth, apps/console, packages/contracts trong WO này.
