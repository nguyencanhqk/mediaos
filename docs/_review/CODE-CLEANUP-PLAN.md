# Kế hoạch dọn code (Part A) — gỡ out-of-scope, gom FE về 3 app

> Mục tiêu: đưa codebase hiện tại về đúng scope bộ docs mới (Foundation + 7 module MVP), GIỮ tối đa code tái dùng. **Chưa thực thi — đây là plan để duyệt.**
> FE app-count đã chốt: **3 app `auth` / `console` / `app`** (khớp CLAUDE.md §7).

---

## A. Backend — thứ tự gỡ AN TOÀN (tránh vỡ build)

> ⚠️ Có 4 điểm coupling nối code out-of-scope vào lõi. Phải gỡ ĐÚNG THỨ TỰ dưới đây, không xóa thư mục trước.

### Bước 1 — Unwire `apps/api/src/app.module.ts`
- Gỡ 2 `APP_GUARD` global của `saas` (subscription/feature-flag/usage-limit guard).
- Gỡ `ApiKeyAuthGuard` global (của `api-keys`).
- Gỡ `imports` các module nhóm DELETE + PARK khỏi `AppModule`.

### Bước 2 — Cắt schema barrel `apps/api/src/db/schema/index.ts`
- Ngừng `export *` các schema parked: media, workflow, finance, kpi, payroll, evaluation, defect, saas, db-ops, observability, templates, break-glass, webhooks, api-keys, chat, meeting.
- Để TypeScript báo đỏ → lộ chính xác chỗ lõi còn lệ thuộc (bước 3).

### Bước 3 — Cắt import schema parked khỏi lõi
| File lõi | Đang import sai | Sửa |
|---|---|---|
| `db/schema/hr.ts` | `tasks` từ `workflow.ts` | bỏ FK/ref workflow; nếu cần task-link dùng `tasks` của module TASK |
| `tasks/tasks.repository.ts` | `contentItems, projects` từ `media` | bỏ ref media; project/task thuần TASK |
| `dashboard/report/*`, `dashboard/.../alerts.service.ts` | `finance`, `media`, `workflow.defects` | bỏ truy vấn finance/media; widget chỉ từ 7 module MVP |
| `org/*` | hook tạo group chat (`ChatModule`) | bỏ hook auto-tạo room chat |
| `scheduler/*` | `db-ops` (DbExportWorker) | chỉ giữ `OutboxWorker` |

### Bước 4 — PARK nhóm out-of-scope
- Tạo `apps/api/src/_parked/` và `git mv` các thư mục: `media`, `workflow`, `approval`, `finance`, `kpi`, `payroll`, `evaluation`, `defect`, `ai`, `meeting`, `chat`, `api-keys`.
- Tạo `apps/api/src/db/schema/_parked/` và move schema tương ứng.
- KHÔNG import `_parked/` ở đâu (TS path-ignore hoặc tách `tsconfig`).

### Bước 5 — DELETE nhóm control-plane/SaaS
- Sau khi bước 1–4 xanh build: `git rm -r` các thư mục `platform`, `saas`, `templates`, `usage`, `db-ops`, `observability`, `operator-bootstrap`, `break-glass`, `webhooks`.

### Bước 6 — Reset migration
- `git mv apps/api/migrations apps/api/migrations.legacy` (archive, còn trong git để tra cứu).
- Xóa `migrations/meta` của drizzle-kit (sẽ sinh lại).
- Sinh lại từ Drizzle schema (đã cắt parked) theo sơ đồ DB-10: thư mục `migrations/{schema,indexes,constraints,backfills}` + đặt tên `{YYYYMMDDNNNN}_{module}_{action}`.
- **Port nội dung** (không bê nguyên file cũ) các migration bất biến nền: RLS+FORCE, audit+outbox, permission seed.

### Bước 7 — Build module `foundation` mới (chưa tồn tại)
Theo BACKEND-04/11: module-registry (app catalog), sequence-counter, public-holiday, data-retention, seed-tracking, file-metadata. Gom phần module-registry hiện rải ở `api-keys` (AC-7) nếu tái dùng được.

### Phân loại backend đầy đủ
| Nhãn | Module |
|---|---|
| KEEP | db, events, permission, crypto, storage, health, common, config, notifications, realtime, users, positions, security-policy, user-invites, recycle-bin |
| ADAPT | auth, employees, org, attendance, leave, tasks, dashboard, settings, scheduler, mail-config |
| PARK | media, workflow, approval, finance, kpi, payroll, evaluation, defect, ai, meeting, chat, api-keys |
| DELETE | platform, saas, templates, usage, db-ops, observability, operator-bootstrap, break-glass, webhooks |

---

## B. Frontend — gom 9 app → 3 app (auth / console / app)

### Mục tiêu
| App | Vai trò | Gộp từ |
|---|---|---|
| `apps/auth` | AuthLayout vùng public (login/forgot/reset, 2FA, SSO) | giữ nguyên `apps/auth` |
| `apps/console` | SYSTEM/Foundation admin: users/roles/permission, company settings, audit viewer, mail, security policy | `apps/console` (lõi) + SALVAGE AC-3/4/5/6 từ `apps/admin` |
| `apps/app` | Home Portal + Module Workspace 6 module: home/dashboard/hr/attendance/leave/tasks/notifications | `apps/web` (Home Portal) + `apps/people` (HR/ATT/LEAVE) + `apps/projects` (TASK) + tasks/kanban từ `apps/studio` |

> App Switcher điều hướng xuyên 3 app = full reload (không phải overlay 1-SPA). `packages/web-core` (auth store/api-client/use-can/i18n) dùng chung cho cả 3 → đăng nhập 1 lần, SSO cookie.

### Bước FE
1. **Dựng `apps/app`** (Vite + React 19 + TanStack Router) với `src/modules/{home,dashboard,hr,attendance,leave,tasks,notifications}` + registry (`appRegistry`/`routeRegistry`/`sidebarRegistry`/`actionRegistry`) hợp nhất.
2. **Port màn hình**: people → hr/attendance/leave; projects → tasks; web → home. Tái dùng `packages/ui` shell (`AppShell`/`AppSidebar`/`PageHeader`).
3. **Bổ sung `packages/ui`**: `AppCard`, `AppGrid`, `AppSwitcher` overlay, `HomePortal` shell, `Breadcrumb` (theo UI-06/FRONTEND-05).
4. **Gộp console**: giữ console lõi; salvage RBAC/API-key/webhook/branding (AC-*) từ admin vào route `/system`.
5. **SALVAGE từ studio rồi xóa vỏ**: cứu `components/tasks/*` (board/kanban/table), `workflows/canvas` (xyflow), `kpi/*`, dashboard card generic. Bỏ `routes/media/*`, `components/{channels,content}`, `revenue-by-channel-chart`.
6. **DELETE `apps/admin`** (operator-plane đa-tenant — out of scope v2 single-tenant) sau khi salvage.
7. **`apps/mobile` để nguyên** (Expo/React Native — Phase MOBILE), không gộp, không xóa.

### Phân loại FE đầy đủ
| Nhãn | App/Package | Ghi chú |
|---|---|---|
| KEEP | apps/auth, packages/contracts, packages/web-core, packages/ui | contracts = DTO chung BE+FE, KHÔNG XÓA |
| MERGE→app | apps/web, apps/people, apps/projects | |
| MERGE→console | apps/console (lõi), AC-* từ apps/admin | |
| SALVAGE→DELETE vỏ | apps/studio | cứu tasks/workflow/kpi |
| DELETE | apps/admin | operator-plane |
| KEEP riêng | apps/mobile | RN, phase sau |

---

## C. ADR
| ADR | Hành động |
|---|---|
| 0001 RLS, 0002 Drizzle, 0003 PgBouncer, 0006 Vite SPA, 0008 TZ UTC, 0009 audit+outbox, 0010 permission, 0011 zero-cost, 0012 NestJS, 0013 Valkey, 0014 R2/MinIO, 0015 shadcn/TanStack, 0022 de-media-fy | KEEP |
| 0016 approval engine | UPDATE → Superseded-by-0022 (LEAVE/ATT duyệt qua Task Hub, không qua engine media) |
| 0007/0018 mobile | KEEP (Deferred Phase 5) |
| (mới) | Tạo ADR "Schema rebuild + migration reset theo DB-10" |

---

## D. Ước lượng giữ lại
- Backend: **~45–55%** KEEP/ADAPT, ~30% PARK, ~15–20% DELETE.
- Frontend: **~65–75%** công sức tái dùng (KEEP+MERGE+SALVAGE), ~25–35% bỏ (vỏ media studio + admin operator-plane).
- Phần viết MỚI thực sự: module `foundation` (BE) + lớp orchestration registry-driven 3 app (FE).
