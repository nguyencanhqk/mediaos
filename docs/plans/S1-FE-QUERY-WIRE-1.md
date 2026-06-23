<!-- ⚙️ KHỐI MÁY-ĐỌC. WO nhỏ (green) — wiring app-level cho query layer + client-version. -->
```yaml
wo: S1-FE-QUERY-WIRE-1
zone: green
generated_by: human
reconciled_at: "2026-06-23 / feat/foundation-wave1 (sau S0-FE-API-1 land 743edb7)"
depends_on: [S0-FE-API-1]   # ✅ DONE — web-core export shouldRetryQuery + configureClientVersion + query-keys
lanes:
  - id: S1-FE-QUERY-WIRE-1
    builder: frontend-builder
    task: >
      Lắp defaultOptions (FRONTEND-04 §16) vào QueryClient của app CÓ react-query + truyền X-Client-Version
      từ build env qua configureClientVersion ở MỌI app. RECONCILE done_when với thực tế code:
      (1) apps/app + apps/console có `new QueryClient()` trần → thêm defaultOptions {queries:{retry:shouldRetryQuery,
      staleTime:30_000, gcTime:5*60_000, refetchOnWindowFocus:false}, mutations:{retry:false}}.
      (2) apps/auth KHÔNG có QueryClient (SPA 1-trang login, comment main.tsx ghi rõ "KHÔNG cần router/query")
      → KHÔNG thêm QueryClient; CHỈ thêm configureClientVersion (auth vẫn gọi apiFetch login → gửi X-Client-Version).
      (3) configureClientVersion(import.meta.env.VITE_APP_VERSION) ở cả 3 main.tsx; thêm `readonly VITE_APP_VERSION?:
      string` vào 3 vite-env.d.ts để typecheck. Hàm thật là configureClientVersion (KHÔNG "configureClient" như
      done_when gốc viết). web-core KHÔNG đổi (ngoài scope; đã export sẵn).
    paths:
      - apps/app/src/main.tsx
      - apps/console/src/main.tsx
      - apps/auth/src/main.tsx
      - apps/app/src/vite-env.d.ts
      - apps/console/src/vite-env.d.ts
      - apps/auth/src/vite-env.d.ts
    acceptanceChecks:
      - "apps/app + apps/console main.tsx: new QueryClient({defaultOptions:{queries:{retry:shouldRetryQuery, staleTime:30_000, gcTime:5*60_000, refetchOnWindowFocus:false}, mutations:{retry:false}}}) — KHÔNG còn QueryClient trần; import shouldRetryQuery từ @mediaos/web-core"
      - "apps/auth main.tsx: KHÔNG thêm QueryClient (app không dùng react-query); CHỈ thêm configureClientVersion"
      - "cả 3 main.tsx gọi configureClientVersion(import.meta.env.VITE_APP_VERSION) cạnh configureApiBaseUrl"
      - "3 vite-env.d.ts thêm `readonly VITE_APP_VERSION?: string;` — import.meta.env.VITE_APP_VERSION typecheck XANH (configureClientVersion bỏ qua undefined → giữ default '0.1.0')"
      - "typecheck + build + test XANH cho @mediaos/app + @mediaos/console + @mediaos/auth; KHÔNG @ts-ignore"
    testTasks:
      - "Không thêm unit test mới (main.tsx = entrypoint, không test trực tiếp). Verify = typecheck + build + existing test suite 3 app xanh (boot/layout/registry/login spec không vỡ)."
    steps:
      - "BƯỚC 1 — apps/app/src/vite-env.d.ts + apps/console + apps/auth: thêm dòng `readonly VITE_APP_VERSION?: string;` vào interface ImportMetaEnv."
      - "BƯỚC 2 — apps/app/src/main.tsx: import {shouldRetryQuery, configureClientVersion}; thêm configureClientVersion(import.meta.env.VITE_APP_VERSION) sau configureAuthAppUrl; đổi `new QueryClient()` → new QueryClient({defaultOptions: DEFAULTS})."
      - "BƯỚC 3 — apps/console/src/main.tsx: y hệt app."
      - "BƯỚC 4 — apps/auth/src/main.tsx: import {configureClientVersion}; thêm configureClientVersion(import.meta.env.VITE_APP_VERSION) sau configureApiBaseUrl. KHÔNG đụng QueryClient (không có)."
      - "BƯỚC 5 — verify: pnpm --filter @mediaos/{app,console,auth} typecheck && build && test."
```

# S1-FE-QUERY-WIRE-1 — Micro-plan (wire QueryClient defaultOptions + X-Client-Version vào apps)

> Zone green → LIGHT gate. Scope `apps/{app,console,auth}/src/**`. depends S0-FE-API-1 (DONE 743edb7).
> WO nhỏ: chỉ wiring app-level. web-core đã export `shouldRetryQuery` + `configureClientVersion` + query-keys.

## 0. Reconcile done_when ↔ code thật (verify 2026-06-23)

| done_when gốc | Thực tế | Hành động |
| --- | --- | --- |
| "apps/{app,console,**auth**} dùng new QueryClient(defaultOptions)" | apps/app + console có `new QueryClient()` trần; **apps/auth KHÔNG dùng react-query** (SPA login 1-trang, main.tsx:21-22 ghi "KHÔNG cần router/query") | QueryClient defaultOptions chỉ cho **app + console**; auth bỏ qua |
| "**configureClient()** truyền X-Client-Version" | Hàm thật export = **`configureClientVersion`** (api-client.ts:45) | dùng `configureClientVersion` ở cả 3 app |
| (ngầm) import.meta.env.VITE_APP_VERSION | 3 app có `vite-env.d.ts` khai ImportMetaEnv tường minh (KHÔNG index-signature) → biến chưa khai = TS error | thêm `readonly VITE_APP_VERSION?: string` vào 3 d.ts |

## 1. defaultOptions (FRONTEND-04 §16.1)
```ts
{ queries: { retry: shouldRetryQuery, staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: false },
  mutations: { retry: false } }
```
`shouldRetryQuery(failureCount, error)` khớp đúng chữ ký `retry` của TanStack Query (đã verify query-retry.ts).

## 2. DRY note (chấp nhận)
defaultOptions lặp ở app + console main.tsx (2 bản). web-core KHÔNG thể host factory QueryClient (sẽ phải thêm dep `@tanstack/react-query` vào package dùng chung — đã loại ở S0-FE-API-1). Không có package app-level chung. → inline 2 bản là đánh đổi đúng (anti-dep > anti-duplication ở đây); 1 object nhỏ, ổn định.

## 3. Out-of-scope
- web-core (đã export đủ; KHÔNG đụng — ngoài paths).
- Module query hooks/optimistic/invalidation cụ thể (FRONTEND-06→12).

## 4. Verify
```bash
pnpm --filter @mediaos/app typecheck && pnpm --filter @mediaos/app build && pnpm --filter @mediaos/app test
pnpm --filter @mediaos/console typecheck && pnpm --filter @mediaos/console build && pnpm --filter @mediaos/console test
pnpm --filter @mediaos/auth typecheck && pnpm --filter @mediaos/auth build && pnpm --filter @mediaos/auth test
```

## 5. Gate
Zone green → LIGHT. Config-only change; reviewer kiểm: defaultOptions đúng §16.1, không đụng auth-no-query, không `@ts-ignore`, env-var khai đúng d.ts.
