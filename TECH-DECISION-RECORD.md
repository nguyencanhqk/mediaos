# TECH-DECISION-RECORD (TDR) — MediaOS

> **Artifact 3/3** của bộ harness. Toàn cảnh các **quyết định kiến trúc bất khả nghịch**.
> Chi tiết từng quyết định (Bối cảnh · Quyết định · Lý do · Hệ quả · Phương án đã loại) nằm ở **[`docs/adr/`](docs/adr/)** — mỗi ADR 1 file. File này là **index + bối cảnh tổng**.
> Đọc kèm `CLAUDE.md` §4 (tech stack) và `CLAUDE-CODE-TOOLKIT.md` (Artifact 2).

---

## Index ADR

| #                                                           | Quyết định                                                    | Trạng thái  | Bất khả nghịch |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ----------- | :------------: |
| [0001](docs/adr/0001-rls-multi-tenant.md)                   | RLS multi-tenant (FORCE RLS, app role non-superuser)          | ✅ Accepted |     ⚠️ Cao     |
| [0002](docs/adr/0002-orm-drizzle.md)                        | ORM = Drizzle (loại Prisma)                                   | ✅ Accepted |     ⚠️ Cao     |
| [0003](docs/adr/0003-pgbouncer-transaction-mode.md)         | Pooling = PgBouncer transaction-mode + `set_config(...,true)` | ✅ Accepted |     ⚠️ Cao     |
| [0004](docs/adr/0004-envelope-encryption-kms.md)            | Envelope encryption + KMS/Vault cho `platform_accounts`       | ✅ Accepted |     ⚠️ Cao     |
| [0005](docs/adr/0005-immutable-payroll-finance-snapshot.md) | Payroll/Finance = snapshot bất biến (append-only)             | ✅ Accepted |     ⚠️ Cao     |
| [0006](docs/adr/0006-frontend-vite-react-spa.md)            | Frontend = Vite + React SPA (1 trust boundary)                | ✅ Accepted |   Trung bình   |
| [0007](docs/adr/0007-mobile-react-native.md)                | Mobile = React Native                                         | ✅ Accepted |   Trung bình   |
| [0008](docs/adr/0008-timezone-utc-at-rest.md)               | Timezone UTC-at-rest, render `Asia/Ho_Chi_Minh`               | ✅ Accepted |     ⚠️ Cao     |
| [0009](docs/adr/0009-audit-outbox-event-bus.md)             | Audit log bất biến + transactional outbox + event bus         | ✅ Accepted |     ⚠️ Cao     |
| [0010](docs/adr/0010-permission-engine-4-tier.md)           | Permission engine 4 tầng, quyền nhạy cảm KHÔNG kế thừa        | ✅ Accepted |     ⚠️ Cao     |
| [0011](docs/adr/0011-zero-cost-infra.md)                    | Hạ tầng $0 (Oracle Always Free / on-prem) + backup offsite    | ✅ Accepted |      Thấp      |
| [0012](docs/adr/0012-backend-nestjs-modular-monolith.md)    | Backend = NestJS modular monolith, contracts Zod              | ✅ Accepted |   Trung bình   |
| [0013](docs/adr/0013-valkey-bullmq-socketio.md)             | Cache/Queue/Realtime = Valkey + BullMQ + Socket.IO            | ✅ Accepted |   Trung bình   |
| [0014](docs/adr/0014-storage-r2-minio-s3.md)                | Storage = Cloudflare R2 / MinIO qua S3 SDK                    | ✅ Accepted |      Thấp      |
| [0015](docs/adr/0015-ui-shadcn-tanstack.md)                 | UI = shadcn/ui + Tailwind v4 + TanStack Table                 | ✅ Accepted |      Thấp      |

> **⚠️ Bất khả nghịch Cao** = đổi sau MVP phải đập đi làm lại nền. Chốt kỹ TRƯỚC khi code.
> Quy ước thêm/đảo ADR: xem [`docs/adr/README.md`](docs/adr/README.md).

---

## Bối cảnh tổng — 3 bất biến & luật phụ thuộc

**3 bất biến không được phá** (ép tự động bằng hook `.claude/hooks/`):

1. `company_id` ở MỌI query nghiệp vụ; ép bằng RLS, qua `withTenant` — ADR [0001](docs/adr/0001-rls-multi-tenant.md), [0003](docs/adr/0003-pgbouncer-transaction-mode.md).
2. Không hard-delete dữ liệu quan trọng; audit/snapshot append-only — ADR [0005](docs/adr/0005-immutable-payroll-finance-snapshot.md), [0009](docs/adr/0009-audit-outbox-event-bus.md).
3. Không secret plaintext; envelope encryption app-side + KMS/Vault — ADR [0004](docs/adr/0004-envelope-encryption-kms.md).

**Luật phụ thuộc (thứ tự bắt buộc):**

```text
Audit + Outbox (event bus)  ──▶  trước mọi module
Permission engine           ──▶  trước module có dữ liệu nhạy cảm
Tenant isolation (RLS)      ──▶  trước khi seed/backfill dữ liệu
```

---

## Đã loại bỏ (license / an toàn)

| Loại                           | Thay bằng                | Lý do                            | ADR                                              |
| ------------------------------ | ------------------------ | -------------------------------- | ------------------------------------------------ |
| Supabase                       | Postgres self-host + RLS | `service_role` bypass RLS        | [0001](docs/adr/0001-rls-multi-tenant.md)        |
| Prisma                         | Drizzle                  | phá outbox + rò tenant trên pool | [0002](docs/adr/0002-orm-drizzle.md)             |
| Next.js (admin)                | Vite SPA                 | SSR rò dữ liệu nhạy cảm          | [0006](docs/adr/0006-frontend-vite-react-spa.md) |
| Redis 8                        | Valkey                   | AGPL                             | [0013](docs/adr/0013-valkey-bullmq-socketio.md)  |
| MUI X Pro / AG Grid Enterprise | TanStack Table           | bẫy license                      | [0015](docs/adr/0015-ui-shadcn-tanstack.md)      |
| Typesense                      | —                        | GPL-3                            | [0015](docs/adr/0015-ui-shadcn-tanstack.md)      |

---

_Liên kết: `CLAUDE.md` §4 (tech stack) · `CLAUDE-CODE-TOOLKIT.md` (Artifact 2) · [`docs/adr/`](docs/adr/) (chi tiết từng ADR)._
