# Kế hoạch tách Frontend — MediaOS

> Trạng thái: **Phase 0–4 + Phase 5 (CODE) ĐÃ LAND · Phase 5 (OPS hạ tầng) = runbook scaffold** · Cập nhật: 2026-06-18
>
> - ✅ Phase 0 (FS-0 web-core/ui) · ✅ Phase 1 (FS-1a api-session + FS-1b apps/auth) · ✅ Wave 2 (FS-2 people + FS-3 studio + FS-4 console).
> - ✅ **Phase 5 phần CODE (FS-5, lane `feat/fs5-cutover` 2026-06-18):** trả nợ Wave 2 (employees-api Bearer; notification bell/api lên @mediaos/{ui,web-core} + gắn lại chuông 4 app) · **apps/web repurpose thành launcher root-domain** (option A — giữ web, gate theo capability, link cross-subdomain) · dọn dead shared-tới-cutover ở web.
> - ⏳ **Phase 5 phần OPS:** runbook `docs/ops/fs5-cutover-runbook.md` + `.env.example` template prod (placeholder `mediaos.example`) — CHƯA land hạ tầng thật (chờ domain/CI/DNS/TLS/Vault).
> - apps/web **GIỮ làm launcher** (KHÔNG xoá — chọn option A thay vì "xoá web" của Phase 4 gốc).
> Phạm vi: tách `apps/web` (1 SPA) → nhiều SPA sản phẩm + shared packages.
> Quyết định đã chốt: **3 product app `studio` + `people` + `console`** (nhóm "system") + **`apps/auth` đăng nhập trung tâm (SSO = PA c, cookie **subdomain** — mục 7)**.
> Tài liệu nền: [CLAUDE.md](../CLAUDE.md) · [docs/SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md)
>
> **✅ Kiểm chứng repo 2026-06-17** (đối chiếu plan ↔ code thật):
>
> - Cây sạch trên `master` (`e76bb8a`); shared kernel (`stores/auth.ts`, `lib/api*.ts`, `hooks/use-can.ts`,
>   `components/{ui,layout}/*`, `employee-format.ts`, `nav.ts`) + `packages/contracts` dual-build **đều có đúng** như mô tả.
> - `router.tsx` (~33 route phẳng + `authGuard`) và `nav.ts` (7 category) **khớp từng dòng**.
> - **Risk #6 ĐÓNG:** `apps/admin` đã có trong cây làm việc, là **Vite SPA scaffold hoàn chỉnh** → dùng làm khuôn mẫu cụ thể.
> - **Nhánh FE redesign `18b98cd` đã merge master** → Phase 0 (freeze FE) không đụng nhánh dở.
> - **Bearer-token fix đã ở master + tốt hơn:** `apiFetch` đã gắn `Authorization` từ `getAccessToken()` **kèm `opts.skipAuth`**
>   (opt-out endpoint công khai). Nhánh cũ `fix/web-apifetch-auth-header` (`bb58080`) bị **superseded → đã xoá** (khôi phục bằng hash nếu cần).
>   ⇒ KHÔNG cần land nhánh nào trước Phase 0.
> - Còn 2 nhánh local `feat/ac5-api-keys` · `feat/ac7-module-registry` chỉ chạm `apps/admin` (ngoài phạm vi) → không xung đột.

---

## 1. Mục tiêu & phi-mục tiêu

**Mục tiêu**
- Tách `apps/web` thành nhiều SPA độc lập theo mảng sản phẩm, mỗi app **build & deploy riêng**, bundle nhẹ hơn, team sở hữu rõ ràng.
- Rút phần dùng chung của FE thành package tái sử dụng (`packages/ui`, `packages/web-core`).
- Giữ **1 backend duy nhất** (`apps/api`) — KHÔNG tách microservices (xem mục 9).

**Phi-mục tiêu (không làm trong kế hoạch này)**
- Không tách `apps/api` thành nhiều service.
- Không tách database / không đụng RLS, permission engine, outbox.
- Không đổi contract DTO (`packages/contracts` giữ nguyên vai trò nguồn sự thật).
- *Ngoại lệ có chủ đích:* **thêm endpoint phiên** vào api đơn (`/auth/refresh`, `/auth/logout`, refresh cookie + rotation/CSRF) cho SSO PA (c) — đây KHÔNG phải tách api (mục 7).

---

## 2. Hiện trạng kiến trúc FE (đã kiểm chứng trên code)

- **1 SPA** `apps/web`: Vite 6 + React 19 + TanStack Router/Query + Zustand + Tailwind v4 + shadcn.
- **Routing thủ công** (không file-based): toàn bộ ~33 route khai báo tập trung trong
  [apps/web/src/router.tsx](../apps/web/src/router.tsx), phẳng dưới 1 `rootRoute`, mỗi route gắn `authGuard`
  đọc [stores/auth.ts](../apps/web/src/stores/auth.ts). ⇒ Cắt rời = di chuyển import + `addChildren` subset.
- **Nav registry = nguồn sự thật DUY NHẤT**: [apps/web/src/lib/nav.ts](../apps/web/src/lib/nav.ts) chia sẵn
  **7 category**: `work · goals · process · hr · attendance · payroll · system`. Đây là đường cắt tự nhiên.
- **Auth = JWT in-memory (Zustand)**: token mất khi refresh, **không chia sẻ giữa các origin** → đây là rủi ro #1.
- **Dep nặng dùng cục bộ**: `@xyflow/react` (chỉ workflows), `recharts` (dashboard/kpi), `socket.io-client`
  (chat/realtime), `qrcode.react` (2FA) → tách app sẽ cô lập được, làm nhẹ bundle.
- **Cây làm việc hiện tại** có `apps/{api,web,mobile,admin}` + `packages/contracts`.
  ✅ `apps/admin` **đã có** trong cây làm việc, là **Vite SPA scaffold hoàn chỉnh**
  (`vite.config.ts`, `vitest.config.ts`, `components.json`, `index.html`, `src/{components,hooks,i18n,lib,routes,stores,test,main.tsx,router.tsx}`)
  → dùng làm **khuôn mẫu cụ thể** để scaffold `auth/studio/people/console` (khỏi clone `web` rỗng).

### Shared kernel hiện tại (mọi feature dùng) — sẽ rút ra package
| Nhóm | File |
| --- | --- |
| Auth/permission | `stores/auth.ts`, `hooks/use-can.ts`, `components/permission-gate.tsx` |
| API client | `lib/api.ts` (+ api-client gắn Bearer / parse envelope) |
| UI primitives | `components/ui/{button,input,dialog,select,skeleton,empty-state,data-table}.tsx` |
| Layout | `components/layout/{app-shell,app-sidebar,page-header}.tsx` |
| i18n | `i18n/{index,format}.ts` + `i18n/locales/vi/{common,nav,auth}.json` |
| Tiện ích | `lib/employee-format.ts`, `lib/nav.ts` (types) |

---

## 3. Quyết định kiến trúc

**Chọn: Monorepo multi-SPA** (nhiều Vite app + shared packages). Đã cân nhắc:

| Chiến lược | Kết luận |
| --- | --- |
| **Multi-SPA + shared packages** | ✅ **CHỌN.** Đúng nghĩa "app riêng", deploy độc lập, bundle nhỏ; `apps/admin` là tiền lệ. |
| 1 app + code-split (lazy/manualChunks) | ❌ Rẻ nhưng vẫn 1 deploy — không đạt mục tiêu "app riêng". |
| Module Federation (micro-frontend runtime) | ❌ Overkill ở quy mô ~200 nhân sự, thêm phức tạp vận hành. |

**Số app:** **3 product app** — `studio`, `people`, **`console`** (nhóm `system`: company settings + platform
accounts + break-glass) — **+ `apps/auth`** (đăng nhập trung tâm, mục 7). `apps/console` là app **riêng** cho màn
system tenant (`aud=user`), **TÁCH BẠCH** với operator plane `apps/admin` (`aud=operator`, cross-tenant, đã có ở
master, NGOÀI phạm vi đợt này). Có thể tách `payroll`→`finance` về sau nếu nhu cầu bảo mật lương cao hơn (ngoài phạm vi).

---

## 4. Ranh giới app (bản đồ di chuyển theo file thật)

### `apps/studio` — work + process + goals (sản xuất nội dung)
| Loại | File / thư mục |
| --- | --- |
| routes | `tasks/*` (index, board, hub) · `media/*` (channels, projects, content + *-detail) · `chat/project-chat` · `workflows/*` (templates, instances + detail) · `dashboard/*` (dashboard, report) · `kpi/*` |
| components | `components/{tasks,workflows,channels,content,projects,dashboard}/*` |
| api (lib) | `tasks-api`, `media-api`, `channels-api`, `content-api`, `projects-api`, `chat-api`, `workflow-*`, `dashboard-api`, kpi-api, `notification-api`, realtime/socket |
| dep cô lập | `@xyflow/react`, `recharts`, `socket.io-client` |
| nav subset | category `work` + `process` + `goals` |

### `apps/people` — hr + attendance + payroll (nhân sự–lương)
| Loại | File / thư mục |
| --- | --- |
| routes | `org/*` (departments, teams, employees, employees-detail, positions, employees-import) · `hr/*` (attendance, adjustments, leave) · `payroll/*` (salary-profiles, periods, payslips, bonus-penalties) |
| components | `components/{hr,payroll}/*`, `components/org-chart` |
| api (lib) | `org-api`, `positions-api`, `employees-api`, `attendance-api`, `leave-api`, `salary-profile-api`, `payroll-period-api`, `payslip-api`, `bonus-penalty-api` |
| nav subset | category `hr` + `attendance` + `payroll` |

### `apps/console` — system (settings tenant; KHÁC operator plane `apps/admin`)
> Tenant-scoped (`aud=user`) — KHÔNG phải operator control-plane `apps/admin` (`aud=operator`, cross-tenant).
| Loại | File / thư mục |
| --- | --- |
| routes | `settings/company`, `settings/platform-accounts`, `settings/break-glass` |
| components | `components/platform-accounts/*` |
| api (lib) | `settings-api`, `platform-accounts-api`, `break-glass-api` |
| nav subset | category `system` |

---

## 5. Cấu trúc đích

```
apps/
  web/         # GIỮ TẠM trong lúc migrate → xoá ở Phase 4
  auth/        # MỚI — SPA đăng nhập trung tâm: /login + 2FA + set-password (SSO, mục 7) — auth.<domain>
  studio/      # MỚI — Vite SPA (work+process+goals) — studio.<domain>, base "/"
  people/      # MỚI — Vite SPA (hr+attendance+payroll) — people.<domain>, base "/"
  console/     # MỚI — nhóm system tenant (company/platform-accounts/break-glass) — console.<domain>, base "/"
  admin/       # operator control plane (aud=operator) — ĐÃ có ở master, NGOÀI phạm vi đợt này
  mobile/      # giữ nguyên
packages/
  contracts/   # ĐÃ CÓ — Zod DTO (nguồn sự thật, không đổi)
  ui/          # MỚI — shadcn primitives + layout + DataTable/PageHeader/EmptyState/Skeleton
  web-core/    # MỚI — auth store, api client (silent-refresh + refresh-on-401), use-can/PermissionGate, i18n setup, nav types
```

### `packages/ui` (component thuần, không state nghiệp vụ)
`components/ui/*` (button, input, dialog, select, skeleton, empty-state, data-table) ·
`components/layout/*` (app-shell, app-sidebar, page-header).
- peerDeps **pin chính xác** `react@19.2.7` / `react-dom@19.2.7` / `@types/react@19.2.16` / `@types/react-dom@19.2.3`
  (tránh pnpm dedupe mismatch — bài học từ `apps/admin`).

### `packages/web-core` (logic dùng chung)
`stores/auth.ts` · `lib/api.ts` + api-client (Bearer + parse envelope) · `hooks/use-can.ts` ·
`components/permission-gate.tsx` · `i18n/` (setup + namespace `common`/`nav`/`auth`) ·
`lib/nav.ts` (chỉ **types** `NavItem`/`NavCategory` + helper `navItemsByCategory`) ·
`lib/auth-api.ts` · `lib/two-factor-api.ts` · `lib/employee-format.ts`.
- Mỗi app khai **subset NAV_ITEMS riêng** nhưng dùng chung kiểu từ đây.
- **Auth:** access token **chỉ in-memory** (KHÔNG localStorage); api-client tự **silent-refresh khi load** +
  **refresh-on-401** (xếp hàng request) + **redirect `/auth`** khi refresh fail (mục 7).

---

## 6. Lộ trình theo phase

> Nguyên tắc: mỗi phase độc lập, `apps/web` luôn build & test xanh cho tới khi xoá ở Phase 4.

### Phase 0 — Rút shared packages (làm TRƯỚC, vẫn 1 app) ⭐ ưu tiên cao nhất
1. Tạo `packages/web-core` + `packages/ui` (copy khung build dual ESM/CJS từ `packages/contracts`).
2. Di chuyển shared kernel (mục 2) + UI primitives vào 2 package; trong `apps/web` đổi import
   `@/...` → `@mediaos/web-core` / `@mediaos/ui` (giữ alias `@` cho phần còn lại của web).
3. Pin React/types như mục 5 ở `packages/ui`.
4. `pnpm install` → build 2 package → `pnpm --filter @mediaos/web test`.
- **DoD:** `web` build xanh, **314 test giữ nguyên, không đổi hành vi**.
- **Giá trị độc lập:** làm sạch ranh giới FE kể cả khi dừng tại đây. Rủi ro thấp, đảo ngược dễ.

### Phase 1 — Nền phiên + App đăng nhập trung tâm `apps/auth` (RỦI RO #1 · crown-jewel) ⭐ chốt chặn
> Làm NGAY sau Phase 0, **TRƯỚC khi tách product app** — không có nó thì app tách ra không đăng nhập được
> (token in-memory không sống qua origin/port khác). Việc auth nhạy cảm → **FULL gate** (mục 7).
1. **api:** `POST /auth/refresh` (rotation + reuse-detection), `POST /auth/logout`, phát refresh cookie
   `Domain=.<domain>` `HttpOnly`/`Secure`/`SameSite=Strict` + CSRF; **CORS allowlist (credentials)** cho subdomain;
   **validate `redirect` theo allowlist origin** (chống open-redirect). Bearer access in-memory giữ nguyên.
2. **`apps/auth`** (subdomain `auth.<domain>`): SPA mỏng — chuyển `routes/login` (+ 2FA + set-password) khỏi `web`;
   đăng nhập xong redirect về `redirect` **đã whitelist**.
3. **`packages/web-core`:** api-client **silent-refresh khi load** + **refresh-on-401** (xếp hàng request) +
   **redirect `auth.<domain>`** khi refresh fail; fetch luôn `credentials:'include'`.
4. **Dev = subdomain `*.localhost`** (`auth.localhost` / `web.localhost` / `api.localhost`) để cookie
   `Domain=.localhost` chạy giống prod; chuẩn bị **TLS wildcard** cho prod.
5. **`apps/web`** chuyển sang luồng mới (bỏ login in-memory thuần) — vẫn 1 product app, auth đã externalize.
- **DoD:** `web` đăng nhập qua `auth.<domain>`; silent-refresh + refresh-on-401 + logout toàn cục chạy; redirect
  allowlist chặn open-redirect; test login cập nhật, phần còn lại xanh.

### Phase 2 — Scaffold + di chuyển `apps/people`
1. Copy khung Vite/tsconfig/tailwind/i18n (mẫu: `apps/admin` nếu có, hoặc clone `apps/web` rỗng).
2. Subdomain `people.<domain>` → `vite.config.ts` `base: "/"`; router không cần `basepath`.
3. Di chuyển routes/components/api theo bản đồ mục 4 (people). Khai NAV_ITEMS subset.
4. `apps/web` **xoá** các route đã chuyển (tránh trùng lặp nguồn sự thật).
- **Đăng nhập:** qua `auth.<domain>` (đã có Phase 1) → `people` dùng được **ngay khi tách**.
- **DoD:** `people` chạy độc lập, test riêng xanh; `web` không còn route people và vẫn xanh.

### Phase 3 — Scaffold + di chuyển `apps/studio`
- Như Phase 2 cho nhóm work + process + goals; subdomain `studio.<domain>`, `base: "/"`.
- `recharts` cô lập được vào `studio`. **`@xyflow/react` KHÔNG cô lập** — `org-chart` (people) cũng dùng
  (mục 2/4) → @xyflow là dep của **cả** `studio` lẫn `people`; chấp nhận, hoặc refactor org-chart bỏ @xyflow trước.
- `socket.io-client` hiện **chưa có importer** trong web (chat REST-only) → chưa tính là lợi ích tách; khi nối
  realtime, thêm origin app vào allowlist WS/CORS của api.

### Phase 4 — Scaffold `apps/console` (nhóm `system`) + dọn `apps/web` ✅ (console ở Wave 2; dọn web ở FS-5 2026-06-18)

> **Cập nhật FS-5:** chọn **giữ `apps/web` làm launcher** (option A) thay vì xoá → "dọn web" = xoá file
> shared-tới-cutover CHẾT (channels/employees/org-api/nav + chat.json), KHÔNG xoá cả app.
- App **riêng** cho màn system tenant (`aud=user`): `settings/company`, `settings/platform-accounts`,
  `settings/break-glass`; subdomain `console.<domain>`, `base: "/"`. **TÁCH BẠCH** operator plane `apps/admin`.
- Di chuyển nốt nhóm `system` khỏi `web` → khi mọi route đã phủ, **xoá `apps/web`**.
- **DoD:** `console` chạy độc lập + test xanh; `apps/web` không còn route nào.

### Phase 5 — Cutover prod (DNS subdomain · TLS wildcard · launcher · CI per-app) — CODE ✅ · OPS ⏳ runbook

> **Cập nhật FS-5 (2026-06-18):** launcher root-domain ĐÃ làm trong `apps/web` (registry 3 app + gate
> capability + link cross-subdomain). Hạ tầng (DNS/TLS/CI/cookie prod) = **runbook `docs/ops/fs5-cutover-runbook.md`
> + `.env.example` template prod** (placeholder `mediaos.example`) — chưa land thật, chờ domain + CI.
- DNS các subdomain + **TLS wildcard `*.<domain>`**; mỗi app deploy riêng (CI per-app), api ở `api.<domain>`.
- Landing/launcher ở root domain: chọn app theo capabilities hoặc redirect theo role.
- **DoD:** đăng nhập 1 lần (cookie `Domain=.<domain>`) dùng được mọi subdomain app; đổi app không login lại.

---

## 7. Auth / SSO xuyên app — **App đăng nhập trung tâm (PA c) [ĐÃ CHỐT]**

**Vấn đề:** token hiện ở in-memory Zustand → mỗi SPA là origin/tab riêng, **không chia sẻ phiên**.

**Quyết định:** chọn **(c) App đăng nhập trung tâm** `apps/auth` — một SPA chuyên trách `/login`, thử thách 2FA,
đặt mật khẩu lần đầu; phát phiên rồi điều hướng về app đích. Lý do: tách rõ trách nhiệm auth khỏi product app,
**một nơi duy nhất** chạm luồng đăng nhập/2FA (dễ review crown-jewel, dễ thêm SSO provider sau), và **giữ access
token in-memory** (không nhét `localStorage` → không bị XSS đánh cắp — đúng tinh thần app có payroll/secret).

> Đã loại: **(a)** cùng domain + token `localStorage` — đơn giản nhưng **phơi access token cho XSS** (giảm cấp bảo
> mật so với in-memory hiện tại). **(b)** subdomain + cookie `Domain=.x` — chuẩn nhưng cần TLS wildcard + CORS;
> có thể nâng lên sau nếu buộc tách subdomain.

**Thiết kế (an toàn theo bất biến dự án):**

1. **Refresh token = cookie `HttpOnly` + `Secure`**, JS không đọc được. Access token **chỉ in-memory** (Zustand),
   TTL ngắn (~5–15 phút).
2. **Subdomain + cookie `Domain=.<domain>`** (hình triển khai đã chốt): `studio.` `people.` `console.` `auth.` +
   `api.<domain>`. Các subdomain là **same-site** → cookie `SameSite=Strict` vẫn tự gửi; nhưng **cross-origin** nên
   api phải bật **CORS allowlist + `Allow-Credentials`** và client `credentials:'include'`. Cần **TLS wildcard
   `*.<domain>`**. Dev dùng `*.localhost` (cookie `Domain=.localhost`) cho giống prod.
3. **Luồng đăng nhập:**
   - App đích (vd `studio`) load → chưa có access token in-memory → gọi `POST /api/v1/auth/refresh` (cookie tự gửi).
   - Có phiên hợp lệ → nhận access token mới, vào app. Không có phiên (401) → redirect `/auth/login?redirect=<đích>`.
   - `apps/auth` đăng nhập + 2FA → api **đặt refresh cookie** → redirect về `redirect`. App đích refresh lại → vào.
4. **Rotation + reuse-detection** (crown-jewel): mỗi lần refresh **xoay** refresh token; nếu một token đã dùng lại
   xuất hiện → **thu hồi cả họ token (family)** + buộc đăng nhập lại. Chống replay khi cookie bị lộ.
5. **CSRF:** endpoint refresh/logout dùng cookie → bắt buộc chống CSRF (double-submit token hoặc header tùy biến
   bắt buộc, kèm `SameSite=Strict`).
6. **Đăng xuất toàn cục:** `POST /api/v1/auth/logout` xóa refresh cookie + thu hồi token family → mọi app mất phiên
   ở lần refresh kế.
7. **`packages/web-core` chuẩn hóa:** api-client tự **silent-refresh khi khởi động** + **refresh-on-401** (xếp hàng
   request trong lúc refresh) + **redirect-to-`/auth`** khi refresh thất bại. Mọi app hành xử y hệt.

**Đụng tới `apps/api` (không phải tách api):** thêm `/auth/refresh`, `/auth/logout`, phát refresh cookie +
rotation/reuse-detection + CSRF + **CORS allowlist (credentials)** cho subdomain + **validate `redirect` theo
allowlist origin** (chống open-redirect). Đây là việc **crown-jewel → FULL gate** (security + silent-failure +
santa). Bearer access token in-memory giữ nguyên cho gọi REST/WS.

> So với (a)/(b): (c) đắt hơn ~1 app + endpoint phiên, đổi lại **access token không bao giờ rời bộ nhớ**, một điểm
> kiểm soát auth, và SSO "đăng nhập 1 lần" tự nhiên cho mọi app qua silent-refresh.

---

## 8. Rủi ro & giảm thiểu

| # | Rủi ro | Giảm thiểu |
| --- | --- | --- |
| 1 | Auth không chia sẻ giữa app | **PA (c) App đăng nhập trung tâm** (mục 7) — refresh cookie HttpOnly + silent-refresh ở `web-core`; làm ở **Phase 1** trước khi tách app |
| 2 | Route path đụng nhau khi gộp sau proxy | Mỗi app `base` riêng + router `basepath`; sửa nhẹ vì routing thủ công (không codegen) |
| 3 | pnpm dedupe mismatch React | Pin chính xác version ở `packages/ui` (mục 5) |
| 4 | Trùng lặp nguồn sự thật (route ở cả web lẫn app mới) | Mỗi phase: chuyển XONG thì **xoá** ở web ngay |
| 5 | Nav registry phân mảnh | Types ở `web-core`; mỗi app khai subset; launcher đọc capabilities |
| 6 | ~~`apps/admin` chưa có trong cây làm việc~~ | ✅ **ĐÓNG (2026-06-17):** `apps/admin` đã có, là Vite SPA scaffold hoàn chỉnh → dùng trực tiếp làm khuôn mẫu scaffold app mới |
| 7 | i18n namespace lẫn giữa app | `common`/`nav`/`auth` ở `web-core`; namespace feature (vd `payroll`, `tasks`) đi theo app dùng nó |
| 8 | Refresh cookie bị lộ / replay | Rotation + **reuse-detection** thu hồi token family; access token TTL ngắn; `SameSite=Strict` |
| 9 | CSRF trên endpoint cookie | Double-submit token / header bắt buộc + `SameSite=Strict`; **FULL gate** review |
| 10 | Access token rời bộ nhớ (XSS) | KHÔNG `localStorage` — access token **chỉ in-memory**, refresh ở HttpOnly cookie (mục 7) |
| 11 | Open-redirect qua `?redirect` | `apps/auth` chỉ redirect tới **allowlist origin** subdomain đã biết; từ chối URL ngoài |
| 12 | CORS credentials cấu hình lỏng | Allowlist **origin tường minh** (không `*`) + `Allow-Credentials`; preflight đúng; chỉ subdomain hợp lệ |
| 13 | `apps/console` lẫn với operator `apps/admin` | `console` = `aud=user` tenant; `admin` = `aud=operator` — KHÁC app, KHÁC cổng auth |

---

## 9. Vì sao KHÔNG tách backend (ghi để khỏi tái tranh luận)

`apps/api` là **modular monolith cố ý** ([CLAUDE.md](../CLAUDE.md)). Chặn việc tách microservices:
1. 1 Postgres + RLS + **~198 tham chiếu FK chéo domain** (employees↔attendance↔payroll↔kpi) → tách DB = distributed tx / nhân bản dữ liệu.
2. Permission engine tập trung (gọi khắp nơi).
3. Audit + transactional outbox `@Global`, lưu DB (in-process).
4. Tenant isolation (`company_id` + `withTenant` + RLS) là tính năng của MỘT db.

⇒ Tách **frontend** rẻ và có lợi ngay; tách backend thì chưa, ở quy mô hiện tại.
(Nếu sau này SaaS ép buộc, thứ tự extract ít ràng buộc nhất: notifications/chat/realtime → media/storage worker → reporting read-service. Giữ HR+payroll+kpi làm MỘT service.)

---

## 10. Ước lượng công sức & thứ tự ưu tiên

| Phase | Việc | Ước lượng | Rủi ro |
| --- | --- | --- | --- |
| 0 | Rút `web-core` + `ui` | 1–2 tuần | Thấp ⭐ (bề mặt lớn → nên freeze FE) |
| 1 | Nền phiên + `apps/auth` (refresh rotation + CSRF + CORS + cookie subdomain) | 1–2 tuần | **Cao (crown-jewel auth, FULL gate)** |
| 2 | `apps/people` | 3–5 ngày | Trung bình |
| 3 | `apps/studio` | 3–5 ngày | Trung bình (dep nặng) |
| 4 | `apps/console` (system) + dọn `web` | 3–5 ngày | Trung bình |
| 5 | Cutover prod (DNS · TLS wildcard · launcher · CI per-app) | 2–4 ngày | Trung bình (hạ tầng) |

**Đề xuất bắt đầu:** **Phase 0 → Phase 1.** Phase 0 dọn ranh giới FE (rủi ro thấp, dừng được bất cứ lúc nào);
Phase 1 (nền phiên + `apps/auth`) là **chốt chặn** — phải xong trước khi tách product app, nếu không app tách ra
không đăng nhập được.

---

## 11. Phụ lục — checklist khởi động Phase 0

- [ ] Tạo `packages/web-core/package.json` (`@mediaos/web-core`, dual-build như contracts)
- [ ] Tạo `packages/ui/package.json` (`@mediaos/ui`, peerDeps React pinned)
- [ ] Thêm vào `pnpm-workspace.yaml`? (đã có `packages/*` → tự nhận)
- [ ] Di chuyển kernel + UI primitives; cập nhật import trong `apps/web`
- [ ] `pnpm install` → `pnpm build` (contracts+ui+web-core) → `pnpm --filter @mediaos/web test` = 314 xanh
- [ ] Cập nhật `TASKS.md` (mục lane FE-split)

---

## 12. Kế hoạch triển khai SONG SONG (multi-lane)

> Áp mô hình fan-out của dự án (CLAUDE.md §9 · TASKS.md §5): 1 worktree/lane · band migration riêng ·
> hot-file append/reconcile · DB cô lập khi verify · gate FULL/LIGHT tách bạch model · **≤2 lane crown chạy cùng lúc**.

### 12.1 Sự thật cốt lõi — parallelism CHỈ thắng ở Wave 2

Đồ thị phụ thuộc **bắt buộc nối tiếp** ở 2 phase đầu:

```text
Phase 0 (packages) ──▶ Phase 1 (auth/SSO) ──▶ ┌─ people  ┐
   [chốt chặn]          [chốt chặn]            ├─ studio  ┤──▶ cleanup web ──▶ cutover prod
                                               └─ console ┘   (Wave 3)        (Phase 5)
                                                (Wave 2: FAN-OUT THẬT)
```

- **Phase 0 & 1 KHÔNG fan-out được**: product app cần `web-core`/`ui` (Phase 0) **và** SSO đăng nhập (Phase 1) tồn tại trước.
  Mở 3 product app sớm = app tách ra không build/không login được. → Hai phase này là **gate nối tiếp**.
- **Wave 2 là nơi song song sinh lợi**: 3 product app **disjoint** theo bản đồ mục 4 → chạy đồng thời 3 worktree.

### 12.2 Bản đồ wave → lane → worktree → gate → model

| Wave | Lane | Worktree | Phạm vi | Migration | Gate | Model |
| --- | --- | --- | --- | --- | --- | --- |
| **0** | `fecore` | `mediaos-fecore` | rút `web-core` + `ui`, đổi import `apps/web` | — | LIGHT + security spot-check (web-core mang token/auth) | Sonnet |
| **1a** | `feauth-api` | `mediaos-feauth` | api: `/auth/refresh` rotation+reuse · `/auth/logout` · refresh cookie · CSRF · CORS allowlist · redirect allowlist | **0400s** | **FULL + santa** (crown-jewel) | **Opus** |
| **1b** | `feauth-app` | `mediaos-feauthapp` | `apps/auth` SPA + `web-core` silent-refresh/refresh-on-401/redirect | — | FULL (auth FE) | Sonnet |
| **2** | `fe-people` | `mediaos-people` | hr+attendance+**payroll** | — | **FULL + santa** (payroll crown) | **Opus** |
| **2** | `fe-studio` | `mediaos-studio` | work+process+goals | — | LIGHT + react-reviewer | Sonnet |
| **2** | `fe-console` | `mediaos-console` | system: company+**platform-accounts**+**break-glass** | — | **FULL + santa** (secret crown) | **Opus** |
| **3** | `fe-cutover` | `mediaos-cutover` | xoá `apps/web` + DNS/TLS wildcard/launcher/CI per-app | — | LIGHT (ops) | Sonnet |

### 12.3 Wave 0 — Phase 0 (1 worktree, freeze FE; song song NỘI BỘ hạn chế)

- Hai gói **disjoint, làm song song được**: **0a `web-core`** (auth store · api-client · use-can · permission-gate · i18n · nav types · auth/two-factor-api · employee-format) **∥ 0b `ui` primitives** (button/input/dialog/select/skeleton/empty-state/data-table/avatar/badge/card).
- **0c hợp nhất (nối tiếp)**: layout components (`app-shell`/`app-sidebar`/`page-header`) **phụ thuộc `web-core`** (dùng nav/useCan/PermissionGate/auth) → vào `ui` SAU 0a; rồi **đổi mọi import `@/…` trong `apps/web`** + verify **314 test xanh**. Đây là phần lớn công sức, **không nên phân mảnh** (bề mặt cao, freeze FE).
- **Gate:** LIGHT (chỉ *di chuyển* code, không đổi logic) **+ security/silent-failure spot-check riêng cho `web-core`** vì nó mang token/auth-api.

### 12.4 Wave 1 — Phase 1 (crown-jewel auth, FULL gate + santa)

- **1a (blocking, crown):** endpoint phiên ở `apps/api` — có **migration band `0400s`** (bảng refresh-token family) → verify trên **`LANE_DB=mediaos_feauth`** (chain-migrate `0000→latest`). Đây là điểm chốt: 1b tiêu thụ contract của 1a.
- **1b (song song theo contract):** `apps/auth` SPA + wiring `web-core` (silent-refresh khi load · refresh-on-401 xếp hàng · redirect `auth.<domain>`). **Scaffold + viết UI song song** với 1a dựa trên contract đã chốt, **tích hợp & test e2e sau khi 1a land**.
- **Crown budget wave này: 1** (chỉ 1a) → an toàn.

### 12.5 Wave 2 — FAN-OUT THẬT: 3 product app đồng thời

- **Disjoint** route/component/api theo mục 4 → 3 worktree chạy song song; mỗi lane **scaffold từ `apps/admin`** (Vite scaffold đã có), khai **NAV_ITEMS subset**, **0 migration** (FE-only).
- **Crown budget = 2** (`people` payroll + `console` secret/break-glass) **+ 1 normal** (`studio`) → **đúng trần ≤2 crown** (bài học rate-limit fan-out). Nếu phiên căng, hạ `studio` ra lượt sau.
- **⚠️ HOT-FILE = `apps/web/src/router.tsx` + `lib/nav.ts`:** cả 3 lane đều **xoá route/nav của mình** khỏi `apps/web` → cùng sửa 2 file này.
  - **Chiến lược (đã có tiền lệ):** mỗi lane xoá đúng **dải dòng của mình** (tách rời, không chồng) → **merge tuần tự `people → studio → console`**, reconcile `router.tsx`/`nav.ts` mỗi lần merge (mechanical, nhỏ).
  - *(Tuỳ chọn nâng cấp:)* prep-commit trước Wave 2 tách `router.tsx` theo category thành sub-route file → mỗi lane xoá **nguyên file**, hết chồng dòng. Thêm 1 bước nhưng merge sạch tuyệt đối.
- **Dep:** `@xyflow/react` là dep chung của **cả `studio` (workflow canvas) lẫn `people` (org-chart)** — khai ở **cả 2** package.json, **không** refactor. `recharts` cô lập gọn vào `studio`. `socket.io-client` chưa có importer (chat REST-only) → bỏ qua tới khi nối realtime.

### 12.6 Wave 3 — cleanup + cutover (nối tiếp, hạ tầng)

- Xoá `apps/web` **sau khi cả 3 app land** + `web` hết route (gộp vào lane `console` vì console di chuyển nhóm system cuối cùng, hoặc lane `fe-cutover` riêng).
- Phase 5 infra: DNS subdomain · **TLS wildcard `*.<domain>`** · launcher root · CI per-app. **Cần quyết định ops** (tên domain), không thuộc song song-hoá code.

### 12.7 Bất biến vận hành áp riêng cho FE-split

1. **Band migration:** chỉ **1a-auth** đụng DB → cấp band **`0400s`** (tránh đụng admin `0300s`). **Verify trần `when`/idx hiện tại trước khi đánh số.** Mọi lane FE khác = **no-migration**.
2. **DB cô lập khi verify:** web lane chạy `pnpm --filter @mediaos/web test` (no-DB); 1a-auth dùng `LANE_DB=mediaos_feauth`.
3. **Hot-file:** `router.tsx`/`nav.ts` reconcile khi merge (mục 12.5); `pnpm-workspace.yaml` tự nhận `packages/*` (không cần sửa).
4. **Crown ≤2 đồng thời** xuyên mọi wave (Opus rate-limit guard).
5. **Merge order = DAG:** `fecore` → `feauth-api` → `feauth-app` → (`people`→`studio`→`console`) → `cutover`. Mỗi merge: chain migration sạch (nếu có) + test xanh.
6. **Worktree:** `git worktree add` mỗi lane; copy `.secrets/local-kek.bin` sang worktree mới (gitignore không theo worktree — bài học cũ) **nếu lane chạy api** (chỉ 1a cần).

### 12.8 Cách khởi chạy

1. **`parallel-lanes` `dryRun:true`** trước mỗi wave → in bảng routing (crown/model/reviewer) **0 token**, xác nhận crown-count.
2. Chạy **tuần tự theo wave**; trong Wave 2 fan-out **1 lượt 3 lane** (≤2 crown).
3. Mỗi lane: vòng RED→GREEN→gate→checkpoint; xanh + non-sensitive → auto-commit `wip(fe-…)`; crown/đỏ → người chốt.

### 12.9 Ước lượng wall-clock (song song vs tuần tự)

| Wave | Tuần tự | Song song |
| --- | --- | --- |
| 0 fecore | 1–2 tuần | 1–2 tuần (gate, không rút ngắn được) |
| 1 auth | 1–2 tuần | ~1–1.5 tuần (1b chồng 1a một phần) |
| 2 product (3 app) | ~2–2.5 tuần (5+4+4 ngày nối) | **~1 tuần** (= max lane, chạy đồng thời) |
| 3 cutover | 2–4 ngày | 2–4 ngày |
| **Tổng** | **~6–8 tuần** | **~4.5–5.5 tuần** |

⇒ Song song hoá **tiết kiệm chủ yếu ở Wave 2** (~1.5 tuần). Hai gate đầu gần như không nén được — đừng kỳ vọng fan-out toàn bộ.
