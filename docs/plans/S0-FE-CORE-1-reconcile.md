<!-- ⚙️ KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
```yaml
wo: S0-FE-CORE-1
zone: red
generated_by: human
reconciled_at: "2026-06-23 / apps/app NOT EXISTS / web-core index.ts verified"
lanes:
  - id: S0-FE-CORE-1
    builder: frontend-builder
    task: >
      Tạo apps/app (SPA vỏ nghiệp vụ) mirror apps/console — chỉ IMPORT web-core public API
      (bootstrapSession/PermissionGate/useCan) + KHÔNG SỬA bất kỳ file nội bộ web-core;
      wiring design token CSS từ packages/ui; kiểm tra bất biến token-storage (grep 0 hits);
      hồi quy 6 spec web-core xanh; i18n vi missing-key + 1 render test.
    paths:
      - "apps/app/**"
      - "packages/ui/**"
    # packages/web-core/** = IMPORT-ONLY: apps/app CHỈ import từ @mediaos/web-core (public API).
    # TUYỆT ĐỐI KHÔNG chỉnh sửa bất kỳ file nào trong packages/web-core/src/.
    forbiddenEdits:
      - "packages/web-core/src/stores/auth.ts"
      - "packages/web-core/src/lib/api-client.ts"
      - "packages/web-core/src/lib/session.ts"
      - "packages/web-core/src/lib/auth-api.ts"
      - "packages/web-core/src/hooks/use-can.ts"
      - "packages/web-core/src/components/permission-gate.tsx"
      - "packages/web-core/src/hooks/use-idle-logout.ts"
acceptanceChecks:
  - "grep -r 'localStorage\\|sessionStorage' apps/ packages/web-core/src/ | grep -E 'access_token|refresh_token|accessToken|refreshToken' = 0 hits (token-storage BẤT BIẾN #3)"
  - "grep -r 'console\\.log.*[Tt]oken\\|console\\.log.*access\\|console\\.log.*refresh' apps/ packages/web-core/src/ = 0 hits (không log token)"
  - "apps/app chỉ import @mediaos/web-core qua public index — grep 'from.*web-core/src' apps/app/ = 0 hits"
  - "pnpm --filter @mediaos/auth build && pnpm --filter @mediaos/console build && pnpm --filter @mediaos/app build tất cả exit 0"
  - "pnpm --filter @mediaos/auth typecheck && pnpm --filter @mediaos/console typecheck && pnpm --filter @mediaos/app typecheck tất cả exit 0"
  - "test smoke apps/app: không có phiên (bootstrapSession trả false) → redirectToAuth() được gọi (KHÔNG render UI)"
  - "packages/ui build (tsc cjs + esm) exit 0; design token CSS (@theme --color-*) xuất hiện trong index.css của apps/app (copy từ apps/console)"
  - "render test: <Button> mount không throw; <EmptyState> mount không throw; <PermissionGate> ẩn children khi capabilities rỗng"
  - "i18n vi: t('common:loading') trả 'Đang tải…' (KHÔNG missing key); 1 render test xác nhận i18nProvider vi khởi tạo đúng"
  - "pnpm --filter @mediaos/web-core test xanh (6 spec hồi quy + use-idle-logout + nav): 0 fail, KHÔNG xóa hoặc sửa để-pass"
testTasks:
  - "packages/web-core/src/hooks/use-can.spec.ts — hồi quy bắt buộc (KHÔNG sửa)"
  - "packages/web-core/src/components/permission-gate.spec.tsx — hồi quy bắt buộc (KHÔNG sửa)"
  - "packages/web-core/src/lib/api-client.spec.ts — hồi quy bắt buộc (KHÔNG sửa)"
  - "packages/web-core/src/lib/session.spec.ts — hồi quy bắt buộc (KHÔNG sửa)"
  - "packages/web-core/src/lib/two-factor-api.spec.ts — hồi quy bắt buộc (KHÔNG sửa)"
  - "packages/web-core/src/lib/auth-api.spec.ts — hồi quy bắt buộc (KHÔNG sửa)"
  - "apps/app/src/test/boot.spec.tsx — MỚI: smoke bootstrap (bootstrapSession false → redirectToAuth gọi 1 lần, KHÔNG render children)"
  - "apps/app/src/test/i18n.spec.tsx — MỚI: t('common:loading') = 'Đang tải…', t('common:noData') = 'Không có dữ liệu' (không missing key)"
  - "packages/ui/src/components/ui/button.spec.tsx — hồi quy (Button render, variant, disabled)"
  - "packages/ui/src/components/ui/dialog.spec.tsx — hồi quy (Dialog a11y, focus-trap, Escape)"
  - "packages/ui/src/components/layout/app-sidebar.spec.tsx — hồi quy (flat + subgroup render)"
steps:
  - "Scaffold apps/app: package.json (name @mediaos/app, cổng 5273 per FRONTEND-01), vite.config.ts, tsconfig.json mirror apps/console"
  - "apps/app/src/index.css: copy design token CSS từ apps/console/src/index.css (@import tailwindcss + @theme --color-*)"
  - "apps/app/src/main.tsx: boot() gọi bootstrapSession() + configureApiBaseUrl + configureAuthAppUrl; false → redirectToAuth(); true → mount React (RouterProvider + QueryClientProvider + I18nextProvider)"
  - "apps/app/src/router.tsx: root route + authGuard (useAuthStore.getState().isAuthenticated || throw redirect(getAuthRedirectUrl())); trang home placeholder /"
  - "apps/app/src/i18n/index.ts: import i18n từ @mediaos/web-core, gọi registerI18nResources cho namespace app nếu cần"
  - "Thêm apps/app vào pnpm workspace (pnpm-workspace.yaml đã có apps/*) + turbo.json nếu chưa có app entry"
  - "Viết apps/app/src/test/boot.spec.tsx: vi.mock bootstrapSession trả false → import main → expect redirectToAuth called"
  - "Viết apps/app/src/test/i18n.spec.tsx: import i18n từ @mediaos/web-core → i18n.t('common:loading') === 'Đang tải…'"
  - "Chạy grep token-storage audit: 0 hits localStorage/sessionStorage chứa access/refresh token key"
  - "pnpm --filter @mediaos/web-core test (hồi quy xanh) → pnpm --filter @mediaos/app typecheck → pnpm --filter @mediaos/app build"
```

# S0-FE-CORE-1 — Micro-plan (reconcile FE core: apps/app CREATE-NEW + token-storage audit)

> Zone: RED / FULL gate (diff chạm auth/session/token import flow). Builder: frontend-builder.
> Reconcile ngày 2026-06-23. apps/app CHƯA tồn tại (đã verify). web-core internal files ĐÃ SHIP — chỉ IMPORT, KHÔNG sửa.

## 0. Kết quả đối chiếu (đã verify line-level)

| done_when | Trạng thái | Hành động |
| --- | --- | --- |
| #1 apps/app CREATE-NEW, chỉ import web-core public API | ⚠️ **chưa tồn tại** | Scaffold từ đầu mirror apps/console (cổng 5273) |
| #2 design token CSS packages/ui wired + build xanh cả 3 app | ⚠️ **apps/app chưa có** | Copy @theme token từ apps/console; packages/ui build đã xanh (dist tồn tại) |
| #3 token-storage BẤT BIẾN + regression xanh | ✅ **web-core src sạch** (grep 0 hits localStorage/sessionStorage) — NHƯNG apps/app chưa tồn tại nên chưa verify toàn phần | Grep audit sau khi scaffold apps/app; 6 spec hồi quy phải xanh |
| #4 i18n vi missing-key check + 1 render test | ⚠️ **chưa có test apps/app** | Viết 2 spec mới (boot + i18n) |

**Đã ship và KHÔNG cần build lại:** `packages/web-core` (dist tồn tại, 6 spec đã xanh), `packages/ui` (dist tồn tại, button/dialog/app-sidebar spec đã có), `apps/auth` (port 5275), `apps/console` (port 5278).

## 1. PHẠM VI THAY ĐỔI

### A. `apps/app/**` — CREATE-NEW (100% mới)

Scaffold mirror `apps/console` với các điều chỉnh:

| File | Nội dung |
| --- | --- |
| `package.json` | name=`@mediaos/app`, port dev=5273, deps tương tự apps/console |
| `vite.config.ts` | port 5273, allowedHosts `.localhost`, alias `@/*` |
| `tsconfig.json` | mirror apps/console (ES2022, strict, paths `@/*`) |
| `vitest.config.ts` | mirror apps/console (jsdom, setup.ts, `src/**/*.spec.{ts,tsx}`) |
| `index.html` | `<div id="root">`, title "MediaOS" |
| `src/index.css` | `@import "tailwindcss"` + copy `@theme { --color-* }` từ apps/console/src/index.css |
| `src/main.tsx` | `boot()`: configureApiBaseUrl + configureAuthAppUrl → bootstrapSession() → false → redirectToAuth() → return; true → createRoot + render |
| `src/router.tsx` | rootRoute + authGuard (isAuthenticated || throw redirect) + home placeholder "/" |
| `src/i18n/index.ts` | re-export i18n từ `@mediaos/web-core`; registerI18nResources nếu app có namespace riêng |
| `src/vite-env.d.ts` | `/// <reference types="vite/client" />` |
| `src/test/setup.ts` | import `@testing-library/jest-dom` |
| `src/test/boot.spec.tsx` | smoke: bootstrapSession=false → redirectToAuth called, không render UI |
| `src/test/i18n.spec.tsx` | t('common:loading') = 'Đang tải…' |
| `src/routes/root-layout.tsx` | `<Outlet />` wrapper với AppShell (placeholder đơn giản) |
| `src/routes/home.tsx` | trang chủ placeholder — sẽ là Home Portal (S1-FE-LAYOUT-1) |

**Import rule tuyệt đối:** `apps/app` CHỈ được import từ:
- `@mediaos/web-core` (public index — `bootstrapSession`, `PermissionGate`, `useCan`, `useAuthStore`, `getAuthRedirectUrl`, `configureApiBaseUrl`, `configureAuthAppUrl`, `redirectToAuth`, `i18n`, `registerI18nResources`, v.v.)
- `@mediaos/ui` (public index)
- `@mediaos/contracts` (Zod DTO)
- `@tanstack/react-router`, `@tanstack/react-query`, `react`, `react-i18next`, `lucide-react`

### B. Không thêm/sửa file nào trong `packages/web-core/src/`

7 file nội bộ BỊ CẤM CHỈNH SỬA (verified real paths):

| File | Lý do cấm |
| --- | --- |
| `packages/web-core/src/stores/auth.ts` | Crown: Zustand store token in-memory, setAccessToken/setTokens |
| `packages/web-core/src/lib/api-client.ts` | Crown: refresh-on-401 single-flight, redirectToAuth, epoch |
| `packages/web-core/src/lib/session.ts` | Crown: bootstrapSession SSO lifecycle |
| `packages/web-core/src/lib/auth-api.ts` | Crown: authApi.login (skipAuth), authApi.me |
| `packages/web-core/src/hooks/use-can.ts` | Crown: O(1) permission check |
| `packages/web-core/src/components/permission-gate.tsx` | Crown: render guard |
| `packages/web-core/src/hooks/use-idle-logout.ts` | Crown: CS-9 idle timer + logoutSession |

### C. `packages/ui/**` — CHỈ additive nếu cần

Nếu component thiếu cho apps/app (ví dụ Toast, Modal, State/Skeleton): thêm component mới vào `packages/ui/src/components/ui/` + export trong `src/index.ts`. KHÔNG sửa component đã ship. Hiện tại packages/ui đã có: Button, Input, Select, Dialog, Skeleton, EmptyState, DataTable, Avatar, Badge, Card, AppShell, AppSidebar, PageHeader, NotificationBell — đủ cho vỏ apps/app giai đoạn này.

## 2. Bất biến giữ nguyên

- **BẤT BIẾN #3 (token-storage):** access/refresh token CHỈ in-memory (Zustand) — KHÔNG bao giờ ghi vào `localStorage`/`sessionStorage`. `setAccessToken` = SSO cookie flow (silent-refresh); `setTokens` = Bearer/mobile flow. `console.log` token bị cấm tuyệt đối. Kiểm tra: `grep -r 'localStorage\|sessionStorage' apps/ packages/web-core/src/ | grep -Ei 'access.token|refresh.token'` phải ra 0 kết quả.
- **Hồi quy 6 spec crown:** use-can / permission-gate / api-client / session / two-factor-api / auth-api không được RED sau khi scaffold apps/app. KHÔNG xóa test, KHÔNG edit-to-pass.
- **BẤT BIẾN #1 (company_id/tenant):** apps/app không chạm DB/backend trực tiếp; api-client đã ép company_id qua context server-side — không liên quan ở bước scaffold này.

## 3. Deviation chấp nhận

- apps/app/src/index.css token design ĐỒNG BỘ với apps/auth + apps/console (copy chính xác `@theme` block) — đây là thiết kế có chủ đích: 3 app cùng ngôn ngữ "Control Room". Không tạo file token riêng (DRY qua copy, chưa có shared CSS package).
- apps/app port 5273: FRONTEND-01 §... ấn định cổng dev; nếu tài liệu chỉ định khác thì ưu tiên tài liệu.

## 4. Verify

```
# 1. Token-storage audit (phải ra 0 hits)
grep -r "localStorage\|sessionStorage" apps/ packages/web-core/src/ | grep -Ei "access.token|refresh.token"

# 2. Không log token
grep -r "console\.log" apps/app/src/ packages/web-core/src/ | grep -Ei "token|access|refresh"

# 3. apps/app không import trực tiếp src web-core
grep -r "from.*web-core/src" apps/app/

# 4. Hồi quy web-core (6 spec crown + use-idle-logout + nav)
pnpm --filter @mediaos/web-core test

# 5. Test mới apps/app
pnpm --filter @mediaos/app test

# 6. Packages ui test (button/dialog/app-sidebar spec xanh)
pnpm --filter @mediaos/ui test

# 7. Typecheck toàn bộ 3 app
pnpm --filter @mediaos/auth typecheck
pnpm --filter @mediaos/console typecheck
pnpm --filter @mediaos/app typecheck

# 8. Build toàn bộ 3 app (design token wired → Tailwind build không lỗi)
pnpm --filter @mediaos/auth build
pnpm --filter @mediaos/console build
pnpm --filter @mediaos/app build
```

Đích: mọi lệnh exit 0; grep token-storage = 0 dòng; `pnpm --filter @mediaos/web-core test` 100% xanh.

## 5. Gate

FULL (zone=RED — diff chạm luồng auth/session import vào app mới):
- `security-reviewer`: kiểm tra token-storage BẤT BIẾN #3, không log token, không import src web-core trực tiếp.
- `silent-failure-hunter`: kiểm tra boot() có catch và redirect thay vì màn trắng câm; bootstrapSession false không bị nuốt.
- `typescript-reviewer` (baseline mọi lane).
- `quality-gate` (baseline mọi lane).

**Human sign-off bắt buộc** trước khi merge (zone RED).

## 6. Out-of-scope (KHÔNG làm ở WO này)

- Home Portal UI thật (layout, widget, module tiles) → **S1-FE-LAYOUT-1** (file kế hoạch đã có: `docs/plans/S1-FE-LAYOUT-1.md`).
- HR / ATT / LEAVE / TASK / DASH / NOTI module screens → Sprint 2 trở đi.
- WebSocket/realtime wiring → sau khi NOTI backend xong.
- apps/app/src/routes/home.tsx chỉ là placeholder — nội dung thật ở S1-FE-LAYOUT-1.
- Storybook → Phase sau MVP.
- Dark mode / SaaS branding → Phase sau MVP.
- Modal/Toast/Drawer component mới trong packages/ui nếu chưa cần → chỉ thêm khi màn hình nghiệp vụ yêu cầu.
