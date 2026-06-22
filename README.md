# Hệ thống Quản lý Doanh nghiệp nội bộ — Enterprise Management System

Nền tảng quản lý doanh nghiệp nội bộ **all-in-one**: số hóa và quản lý tập trung tài khoản/phân quyền, nhân sự, chấm công, nghỉ phép, công việc, dashboard và thông báo trên **một** hệ thống — thay cho Excel/Google Sheet/email/tin nhắn rời rạc.

Kiến trúc: **Modular Monolith + API-first**. Chạy **đơn-công-ty (N=1)**; hạ tầng cô lập dữ liệu giữ nguyên để sẵn sàng mở rộng đa-công-ty/SaaS về sau — **không** phải mục tiêu hiện tại.

> **Nguồn sự thật sản phẩm:** bộ tài liệu trong [`docs/`](docs/) — bắt đầu từ **[chỉ mục trung tâm `docs/README.md`](docs/README.md)**. Định hướng cấp cao: **[PRD-00](<docs/PRD/PRD-00 Enterprise Management System .md>)**. Đặc tả nghiệp vụ: [`docs/spec/`](docs/spec/) + [`docs/SPEC/`](docs/SPEC/) (SPEC-01…08).
>
> ⚠️ **De-media-fy (2026-06-20):** dự án đã reframe từ "OS cho công ty media" thành hệ QLDN chung. Code media/finance/payroll/SaaS/operator-plane cũ được **park hoặc đang dọn dần** (out-of-scope) — lấy `docs/` làm chuẩn khi mâu thuẫn.

---

## Sản phẩm là gì

### Module MVP (Version 1.0)

| Mã | Module | Vai trò | Spec |
| --- | --- | --- | --- |
| **AUTH** | Tài khoản, đăng nhập & phân quyền | Xác thực, tài khoản, vai trò, quyền, data scope | [SPEC-02](<docs/SPEC/SPEC-02 AUTH.md>) |
| **HR** | Quản lý nhân sự | Hồ sơ nhân viên, phòng ban, chức vụ, hợp đồng | [SPEC-03](<docs/SPEC/SPEC-03 HR.md>) |
| **ATT** | Chấm công | Check-in/out, bảng công, ca làm, rule, điều chỉnh công | [SPEC-04](<docs/SPEC/SPEC-04 ATT.md>) |
| **LEAVE** | Nghỉ phép | Đơn nghỉ, duyệt, số dư phép, đồng bộ sang ATT | [SPEC-05](<docs/SPEC/SPEC-05 LEAVE.md>) |
| **TASK** | Công việc & dự án | Project, task, giao việc, kanban, comment, file | [SPEC-06](<docs/SPEC/SPEC-06 TASK.md>) |
| **DASH** | Dashboard | Tổng hợp dữ liệu theo vai trò | [SPEC-07](<docs/SPEC/SPEC-07 DASH.md>) |
| **NOTI** | Thông báo hệ thống | Tạo & hiển thị thông báo in-app | [SPEC-08](<docs/SPEC/SPEC-08 NOTI.md>) |

Nhóm người dùng: **Super Admin · Admin công ty · HR · Manager · Employee · Project Manager** (PRD §7).

### Sau MVP (thiết kế để mở rộng — CHƯA làm)

PAYROLL · RECRUIT (Phase 2) · ASSET · ROOM (Phase 3) · CHAT · SOCIAL (Phase 4) · MOBILE · AI (Phase 5). Chi tiết: [PRD-00 §8.2](<docs/PRD/PRD-00 Enterprise Management System .md>).

---

## Tech Stack

| Tầng | Công nghệ |
|------|-----------|
| Backend | NestJS · TypeScript (modular monolith) · `nestjs-zod` |
| Database | PostgreSQL 16/17 · **RLS + FORCE** · UUID PK |
| ORM | Drizzle |
| Pooling | PgBouncer (transaction-mode) + `set_config('app.current_company_id', …)` |
| Cache / Queue / Presence | Valkey · BullMQ |
| Realtime | NestJS WebSocketGateway · Socket.IO · Valkey adapter |
| Storage | Cloudflare R2 / MinIO (qua `@aws-sdk/client-s3`) |
| Frontend | Vite · React 19 SPA · TanStack Router/Query · Zustand |
| UI | shadcn/ui · Tailwind v4 · React Hook Form · Zod · TanStack Table v8 |
| i18n / TZ | react-i18next (vi) · date-fns v4 (UTC-at-rest) |
| Monorepo | pnpm · Turborepo |

Stack đã chốt + lý do loại trừ (Supabase/Prisma/Redis/Next.js…): [DECISIONS-02](docs/DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

---

## Cấu trúc

```text
.
├── apps/
│   ├── api/          # @mediaos/api — NestJS modular monolith, backend DUY NHẤT
│   ├── auth/         # @mediaos/auth — đăng nhập + 2FA (Vite/React SPA)
│   └── console/      # @mediaos/console — quản trị hệ thống (user/role/permission/cấu hình)
├── packages/
│   ├── contracts/    # @mediaos/contracts — Zod = nguồn sự thật DTO (dual-build ESM+CJS)
│   ├── ui/           # @mediaos/ui — shadcn primitives + layout
│   └── web-core/     # @mediaos/web-core — auth store · api-client · use-can · i18n
├── docs/             # bộ tài liệu — chỉ mục trung tâm: docs/README.md
│   ├── PRD/ SPEC/ DB/ "API Design"/ UI/ FRONTEND/ BACKEND/ QA/    # thiết kế theo nhóm
│   ├── DECISIONS/ DEVOPS/ COMPLIANCE/ IMPLEMENTATION/             # quyết định · vận hành
│   ├── spec/         # SPEC-01…08 (bản máy + người đọc)
│   ├── erd-current.md · permission-matrix-spec.md
│   └── STATUS.md     # TỰ SINH — "đang ở đâu, làm gì kế" (KHÔNG sửa tay)
├── harness/          # cách làm việc có kiểm soát (backlog · init/check/finish · policy)
└── scripts/          # setup-db-roles.mjs · backup-db.sh · lane-db-setup.sh · deploy.sh …
```

> **Vỏ nghiệp vụ hợp nhất `apps/app`** (gom 7 module MVP: HR·ATT·LEAVE·TASK·DASH·NOTI) **đang trong lộ trình build** (Wave sau Foundation) — chưa có trong cây code. Tiến độ live: [docs/STATUS.md](docs/STATUS.md). Một số code/schema hướng cũ (media/finance/SaaS) còn nằm trong `apps/api` đang được dọn dần (de-media-fy 2026-06-20).

---

## Yêu cầu

- Node.js ≥ 20 · pnpm 11 · Docker & Docker Compose

---

## Bắt đầu

```bash
cp .env.example .env          # điền thông tin cần thiết
pnpm install

pnpm db:up                    # Postgres + PgBouncer + Valkey + MinIO (docker compose)
pnpm db:setup-roles           # tạo 3 DB role (owner/app/worker)
pnpm db:migrate               # áp migration (chain 0000 → latest)

pnpm dev                      # api + web SPA song song (turbo)
```

---

## Lệnh thường dùng

```bash
# Toàn workspace (turbo)
pnpm dev | build | lint | typecheck | test | format

# Hạ tầng + DB
pnpm db:up | db:down | db:migrate | db:setup-roles

# Theo từng app/package
pnpm --filter @mediaos/api      dev | build | test | typecheck
pnpm --filter @mediaos/auth     dev | build | test | typecheck
pnpm --filter @mediaos/console  dev | build | test | typecheck

# Sinh migration sau khi sửa Drizzle schema
pnpm --filter @mediaos/api db:generate

# Bảng theo dõi tiến độ Work Order
pnpm dashboard
```

---

## API

| Endpoint | Mô tả |
|----------|-------|
| `GET /api/v1/health` | Liveness check |
| `GET /api/v1/health/db` | Readiness check (DB) |
| `POST /api/v1/auth/login` | Đăng nhập |
| `POST /api/v1/auth/refresh` | Làm mới access token |
| `GET /api/v1/auth/me` | User hiện tại + capabilities |

Mọi response bọc trong envelope nhất quán: `{ "success": true, "data": { … }, "error": null }` (lỗi → `{ "success": false, "data": null, "error": { … } }`).

> Hợp đồng API đầy đủ + chuẩn chung (auth, response, lỗi, pagination, idempotency): [docs/API Design/](<docs/API Design/API-01 TỔNG QUAN.md>) + OpenAPI/Swagger.

---

## Bất biến bắt buộc (không bao giờ được phá)

1. **`company_id` ở MỌI query** dữ liệu nghiệp vụ — cô lập tenant ép ở tầng DB bằng **RLS + FORCE**, không dựa vào kỷ luật dev (chạy N=1, hạ tầng giữ nguyên để sẵn sàng mở rộng).
2. **Không hard-delete** dữ liệu quan trọng — dùng `deleted_at` (soft delete); bảng **audit/snapshot là append-only** (app role không có UPDATE/DELETE).
3. **Không secret plaintext** — mật khẩu user → **hash**; secret hệ thống → env/secret manager (không hard-code, không log).

3 bất biến này được ép tự động bởi hook trong [`.claude/hooks/`](.claude/hooks/). Chi tiết: [CLAUDE.md §2](CLAUDE.md) · [DECISIONS-02](docs/DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

---

## Tài liệu

- **[docs/README.md](docs/README.md)** — **chỉ mục trung tâm** của toàn bộ tài liệu (PRD · SPEC · DB · API · UI · FRONTEND · BACKEND · QA).
- [docs/PRD/PRD-00](<docs/PRD/PRD-00 Enterprise Management System .md>) — định hướng sản phẩm, phạm vi MVP, người dùng mục tiêu.
- [docs/spec/](docs/spec/) + [docs/SPEC/](docs/SPEC/) — **SPEC-01…08, đặc tả nghiệp vụ** (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI).
- [docs/erd-current.md](docs/erd-current.md) — ERD · [docs/permission-matrix-spec.md](docs/permission-matrix-spec.md) — phân quyền.
- [docs/DECISIONS/](docs/DECISIONS/) · [docs/QA/](docs/QA/) · [docs/DEVOPS/](docs/DEVOPS/) · [docs/COMPLIANCE/](docs/COMPLIANCE/) — quyết định · kiểm thử · vận hành · tuân thủ.
- [CLAUDE.md](CLAUDE.md) · [AGENTS.md](AGENTS.md) — hợp đồng vận hành · [docs/STATUS.md](docs/STATUS.md) — đang ở đâu / làm gì kế (tự sinh).
