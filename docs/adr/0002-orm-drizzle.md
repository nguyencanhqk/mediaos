# ADR-0002 — ORM = Drizzle (loại Prisma)

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0003](0003-pgbouncer-transaction-mode.md), [0009](0009-audit-outbox-event-bus.md), [0012](0012-backend-nestjs-modular-monolith.md)

## Bối cảnh

Cần ORM TypeScript hợp với RLS + transactional outbox + PgBouncer transaction-mode.

## Quyết định

Dùng **Drizzle ORM** + bộ migration của Drizzle.

## Lý do

Drizzle SQL-first, kiểm soát connection/transaction rõ ràng, set `set_config(...,true)` trong cùng transaction dễ. Prisma dùng engine riêng + RLS-extension phá **outbox** (ghi event cùng transaction nghiệp vụ) và rò context tenant trên connection pool.

## Hệ quả

Schema + migration viết kiểu Drizzle. `packages/contracts` (Zod) là nguồn sự thật DTO, không sinh type từ Prisma.

## Phương án đã loại

- **Prisma** — phá outbox + rò tenant trên pool.
- TypeORM — query builder kém type-safe, migration kém tin cậy.
