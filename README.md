# MediaOS

Hệ thống quản trị nội bộ cho công ty media — quản lý nhân sự, kênh, sản xuất video, workflow duyệt nội dung, lương và tài chính.

Kiến trúc: **Modular Monolith + API-first + SaaS-ready** (~200 nhân sự · 100 kênh · 300 video/tháng).

---

## Tech Stack

| Tầng | Công nghệ |
|------|-----------|
| Backend | NestJS · TypeScript · `nestjs-zod` |
| Database | PostgreSQL 17 · RLS + FORCE · UUID PK |
| ORM | Drizzle |
| Pooling | PgBouncer (transaction-mode) |
| Cache / Queue | Valkey 8 · BullMQ |
| Storage | MinIO / Cloudflare R2 |
| Frontend | Vite · React 19 · TanStack Router/Query · Zustand |
| UI | shadcn/ui · Tailwind v4 · React Hook Form · Zod |
| Monorepo | pnpm · Turborepo |

---

## Cấu trúc

```
mediaos/
├── apps/
│   ├── api/          # NestJS modular monolith (:3100)
│   └── web/          # Vite + React 19 SPA (:5273)
├── packages/
│   └── contracts/    # Zod schemas — nguồn sự thật DTO (dual-build ESM+CJS)
├── docs/             # ADR, spikes, design docs
└── scripts/          # backup-db.sh, setup-db-roles.mjs
```

---

## Yêu cầu

- Node.js ≥ 20
- pnpm 11
- Docker & Docker Compose

---

## Bắt đầu

```bash
# 1. Clone và cài dependencies
git clone git@github.com:nguyencanhqk/mediaos.git
cd mediaos
cp .env.example .env          # điền thông tin cần thiết
pnpm install

# 2. Khởi động hạ tầng (Postgres + PgBouncer + Valkey + MinIO)
pnpm db:up

# 3. Tạo DB roles + chạy migration
pnpm db:setup-roles
pnpm db:migrate

# 4. Chạy dev
pnpm dev                      # api :3100 + web :5273
```

---

## Lệnh thường dùng

```bash
pnpm dev              # chạy api + web song song
pnpm build            # build toàn workspace
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest toàn workspace
pnpm format           # Prettier

pnpm db:up            # docker compose up -d
pnpm db:down          # docker compose down
pnpm db:migrate       # áp migration (DATABASE_DIRECT_URL)

# Riêng từng app
pnpm --filter @mediaos/api  dev|build|test|typecheck
pnpm --filter @mediaos/web  dev|build|test|typecheck

# Sinh migration mới (sau khi sửa schema)
pnpm --filter @mediaos/api db:generate
```

---

## API

| Endpoint | Mô tả |
|----------|-------|
| `GET /api/v1/health` | Liveness check |
| `GET /api/v1/health/db` | Readiness check |
| `POST /api/v1/auth/login` | Đăng nhập (`companySlug` + email + password) |
| `POST /api/v1/auth/refresh` | Làm mới access token |
| `GET /api/v1/auth/me` | Thông tin user hiện tại + capabilities |

Mọi response đều bọc trong envelope:

```json
{ "success": true, "data": { ... }, "error": null }
```

---

## Bất biến bắt buộc

1. **`company_id` ở mọi query** — tenant isolation ép bằng RLS ở tầng DB, không dựa kỷ luật dev
2. **Không hard-delete** dữ liệu quan trọng — dùng `deleted_at`; bảng audit/snapshot là append-only
3. **Không secret plaintext** — mật khẩu user → argon2id; tài khoản kênh → envelope encryption + KMS

---

## Tiến độ

| Giai đoạn | Nội dung | Trạng thái |
|-----------|----------|-----------|
| G1 | Bootstrap repo & hạ tầng | ✅ |
| G2 | Nền bảo mật & đa-tenant (RLS, audit, outbox) | ✅ |
| G3 | Permission Engine (4 tầng, Valkey cache) | ✅ |
| G4 | MVP-0 Walking Skeleton (workflow, tasks, approval, chat) | 🟡 đang làm |
| G5–G16 | Tổ chức · Media · Workflow Builder · HR · Lương · Finance · Dashboard · Mobile · SaaS | ☐ |

Chi tiết: [TASKS.md](TASKS.md)

---

## Tài liệu

- [CLAUDE.md](CLAUDE.md) — quy tắc vận hành, bất biến, review gate
- [docs/adr/](docs/adr/) — 15 Architecture Decision Records
- [TASKS.md](TASKS.md) — lộ trình và tiến độ chi tiết
- [TÀI LIỆU CHO ĐỘI DEV.md](TÀI%20LIỆU%20CHO%20ĐỘI%20DEV.md) — hướng dẫn dev
