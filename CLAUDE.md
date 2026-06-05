# CLAUDE.md — MediaOS

> Hợp đồng vận hành cho mọi phiên Claude Code làm việc trên dự án này.
> Đọc file này TRƯỚC khi sửa code. Các quy tắc ở đây **ghi đè** thói quen mặc định.

---

## 1. Dự án là gì

**MediaOS** — hệ thống quản trị nội bộ công ty media (~200 nhân sự, 100 kênh, 300 video/tháng), kiến trúc **Modular Monolith + API-first + SaaS-ready**. Sẽ mở rộng thành SaaS sau khi vận hành nội bộ ổn.

Tài liệu nguồn (cùng thư mục): `MVP REQUIREMENT...`, `DATABASE ERD...`, `USER ROLE & PERMISSION MATRIX...`, `THIẾT KẾ WORKFLOW MẪU...`, `THIẾT KẾ MÀN HÌNH WEB-MOBILE...`, `KẾ HOẠCH CHIA PHASE...`, `TÀI LIỆU CHO ĐỘI DEV...`. Kế hoạch thực thi: `TASKS.md`. Quyết định kiến trúc: `docs/adr/`.

---

## 2. BẤT BIẾN — không bao giờ được phá

1. **`company_id` ở MỌI query** dữ liệu nghiệp vụ. Tenant isolation ép ở tầng DB bằng **RLS**, KHÔNG dựa vào kỷ luật dev. Mọi repository đi qua `withTenant(companyId, fn)`.
2. **Không hard-delete** dữ liệu quan trọng. Dùng `deleted_at` (soft delete). Bảng audit/snapshot (`audit_logs`, `payslips`, `kpi_results`, `profit_snapshots`, `revenue_records`, `cost_records`, …) là **append-only** — app role không có quyền UPDATE/DELETE.
3. **Không secret plaintext.** Mật khẩu user → hash. Mật khẩu tài khoản kênh (`platform_accounts`) → **envelope encryption + KMS/Vault**, mã hóa **phía app**, không bao giờ pgcrypto-in-SQL, không log, không vào DTO của role không quyền.

> 3 bất biến này được ép tự động bởi hook trong `.claude/hooks/` (xem mục 6).

---

## 3. Luật phụ thuộc (thứ tự bắt buộc)

```text
Audit log + Event bus (outbox)  ──▶  PHẢI có trước mọi module
Permission engine               ──▶  trước mọi module có dữ liệu nhạy cảm
Tenant isolation (RLS)          ──▶  trước khi seed/backfill dữ liệu
```

- Không code module nhạy cảm (lương, tài khoản kênh, tài chính) khi `PermissionService` chưa xong.
- Migration: tạo **RLS policy + FORCE RLS TRƯỚC** khi backfill `company_id` (nếu không sẽ có cửa sổ rò rỉ chéo tenant).

---

## 4. Tech stack (đã chốt — xem `docs/adr/`)

| Tầng                 | Chọn                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Backend              | NestJS + TypeScript (modular monolith), `nestjs-zod`                                                                            |
| DB                   | PostgreSQL 16/17 self-host, **RLS** + FORCE, UUID PK                                                                            |
| ORM                  | **Drizzle** (KHÔNG Prisma — phá outbox + rò tenant trên pool)                                                                   |
| Pooling              | **PgBouncer transaction-mode** + `set_config('app.current_company_id', $1, true)`; pool direct riêng cho LISTEN/NOTIFY + BullMQ |
| Cache/Queue/Presence | **Valkey** + BullMQ                                                                                                             |
| Realtime             | NestJS WebSocketGateway + Socket.IO + Valkey adapter, room `co:{companyId}:…`                                                   |
| Secrets              | Envelope encryption + KMS/Vault (app-side)                                                                                      |
| Storage              | Cloudflare R2 / MinIO (qua `@aws-sdk/client-s3`)                                                                                |
| Frontend             | **Vite + React 19 SPA** (1 trust boundary) + TanStack Router/Query + Zustand                                                    |
| UI                   | **shadcn/ui** + Tailwind v4 + React Hook Form + Zod                                                                             |
| Data grid            | TanStack Table v8 (headless) — KHÔNG MUI X Pro/AG Grid Enterprise (bẫy license)                                                 |
| Workflow canvas      | React Flow / @xyflow/react                                                                                                      |
| Charts               | Recharts + Tremor                                                                                                               |
| i18n / TZ            | react-i18next (vi) + date-fns v4 + @date-fns/tz (UTC-at-rest)                                                                   |
| Monorepo             | pnpm + Turborepo; `packages/contracts` = Zod là nguồn sự thật DTO                                                               |

**Loại bỏ:** Supabase (service_role bypass RLS), Redis 8 (AGPL), Next.js cho admin (SSR rò dữ liệu nhạy cảm), Typesense (GPL-3).

---

## 5. Quy tắc code

**Backend:** business logic ở Service (không ở Controller); Repository/ORM lo DB; DTO validate input; mọi API check `company_id`; API nhạy cảm check permission; không hard-code workflow/role/phòng ban.

**Frontend:** không hard-code permission (dùng `<PermissionGate>` + `useCan()`); dữ liệu nhạy cảm **mask mặc định** (masking là việc của SERVER — client không nhận được thì không render được); form có validation; table có pagination/filter; status/text dùng constants chung.

**File:** nhiều file nhỏ (200–400 dòng, max 800), tổ chức theo feature/domain.

**Realtime:** payload WS PHẢI qua cùng DTO/masking layer như REST — cấm `io.emit` thẳng row.

---

## 6. Review gate PHÂN TẦNG (kiểm soát chi phí)

- **FULL gate** — diff chạm `permission / RLS / secret / payroll / audit`:
  `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` (+ `ecc:santa-method` cho logic crown-jewel).
- **LIGHT gate** — CRUD/UI thường:
  `ecc:typescript-reviewer` + `ecc:quality-gate`.
- **Test deny-path TRƯỚC** (RED) cho permission/workflow/payroll. Coverage ≥80% (ngưỡng riêng cho module nhạy cảm).

**Model routing:** Haiku → build-fix/CRUD/docs; Sonnet → phát triển module; Opus → spike khó (workflow FSM, permission algebra, payroll, ADR).

---

## 7. Lệnh dự án

> Cập nhật G1 (đã bootstrap). Node ≥20, pnpm 11. Lần đầu: `cp .env.example .env`.

```bash
pnpm install                       # cài deps (allowBuilds: esbuild/swc/nest)
pnpm dev                           # chạy api (:3000) + web (:5173) song song (turbo)
pnpm build                         # build contracts (dual ESM/CJS) + api (nest) + web (vite)
pnpm lint                          # eslint flat config toàn workspace
pnpm typecheck                     # tsc --noEmit (contracts build trước qua turbo)
pnpm test                          # vitest run mọi package (api dùng swc cho DI)
pnpm format                        # prettier --write .

# Hạ tầng + DB (cần Docker)
pnpm db:up                         # docker compose up -d (Postgres/PgBouncer/Valkey/MinIO)
pnpm db:down                       # docker compose down
pnpm --filter @mediaos/api db:generate   # drizzle-kit generate (sinh migration từ schema)
pnpm db:migrate                    # áp migration qua DATABASE_DIRECT_URL

# Lẻ từng app
pnpm --filter @mediaos/api dev|build|test|typecheck
pnpm --filter @mediaos/web dev|build|test|typecheck

# Backup (G1-8)
bash scripts/backup-db.sh          # pg_dump → encrypt → rclone offsite (xem .env BACKUP_*)
```

> **Cấu trúc:** `apps/api` (NestJS modular monolith) · `apps/web` (Vite+React19 SPA) · `packages/contracts` (Zod = nguồn sự thật DTO, dual-build). Health: `GET /api/v1/health` + `/health/db` (fail-soft).

---

## 8. Definition of Done

Code xong · migration nếu đổi DB · validation input · permission guard nếu cần · FE xử lý loading/error/empty · có test · **audit log nếu hành động quan trọng** · QA pass · không phá luồng chính · cập nhật `TASKS.md`.
