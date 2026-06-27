# DECISIONS-02 — Khóa Stack & Hiện thực 3 Bất biến (đính chính bắt buộc)

> **Trạng thái: ĐÃ CHỐT.** Tài liệu này **ghi đè** mọi nhắc tới Next.js / Prisma / Redis / Jest / Pytest / `NEXT_PUBLIC_` còn sót trong bộ docs, và bổ sung phần hiện thực 3 bất biến (RLS+FORCE, audit append-only, outbox) mà các tài liệu DB/BACKEND/DEVOPS chưa mô tả.
> Lý do tồn tại: rà soát 2026-06-21 phát hiện (a) bộ docs lẫn công nghệ đã bị loại, (b) 3 bất biến của dự án chỉ tồn tại như khẩu hiệu, không có DDL/cơ chế. Xem `_review/REVIEW-FINDINGS.md`.

---

## 1. Stack đã CHỐT (override toàn bộ docs)

| Hạng mục | ĐÚNG (dùng) | SAI (mọi nhắc tới trong docs là lỗi thời) |
|---|---|---|
| Frontend | **Vite + React 19 SPA + TanStack Router/Query + Zustand** | ~~Next.js App Router~~, ~~`next/navigation`~~, ~~SSR/RSC~~ |
| Biến môi trường FE | **`VITE_*`** | ~~`NEXT_PUBLIC_*`~~ |
| ORM | **Drizzle + drizzle-kit** | ~~Prisma~~, ~~`schema.prisma`~~, ~~`prisma migrate`~~ |
| Cache/Queue/Presence | **Valkey + BullMQ** | ~~Redis~~ (Redis 8 = AGPL) |
| Test runner | **Vitest** (+ Supertest cho API) | ~~Jest~~, ~~Pytest~~ |
| Backend | NestJS + TypeScript (modular monolith) | — (đã đúng) |
| DB | PostgreSQL 16/17 + **RLS + FORCE**, UUID PK | — |
| Pooling | **PgBouncer transaction-mode** + pool direct riêng cho LISTEN/NOTIFY + BullMQ | — |

> Lý do FE cấm Next.js: SSR render dữ liệu nhạy cảm phía server → rủi ro rò khi quyền/masking lệch. SPA + permission-gate + masking server-side là mô hình an toàn của dự án (ADR-0006/0015).

### 1.1 Bản đồ chuyển Prisma → Drizzle (cho mọi tài liệu nhắc Prisma)

| Prisma (docs cũ) | Drizzle (chuẩn) |
|---|---|
| `prisma/schema.prisma` | `apps/api/src/db/schema/*.ts` (schema bằng TypeScript) |
| `prisma generate` | `drizzle-kit generate` (sinh SQL migration từ schema) |
| `prisma migrate deploy` | áp migration qua migrator (drizzle) trên `DATABASE_DIRECT_URL` |
| `prisma migrate dev` | `drizzle-kit generate` + áp tay khi dev |
| `prisma migrate status` | so head migration vs journal `migrations/meta` |
| `prisma studio` | `drizzle-kit studio` |
| `PrismaClient` / `prisma.service.ts` | `drizzle(pool)` client + `db` provider, mọi truy vấn qua `withTenant()` |
| `@map`, `provider="prisma-client-js"` | cấu hình ở `drizzle.config.ts` (dialect `postgresql`) |

> Lưu ý kiến trúc: **KHÔNG dùng Prisma** vì Prisma phá outbox transactional + không set được tenant context an toàn trên PgBouncer transaction-mode pool (ADR-0002).

### 1.2 Redis → Valkey
Valkey tương thích giao thức Redis → mọi client (ioredis/BullMQ), lệnh, port 6379 giữ nguyên; chỉ đổi tên/ảnh: image `valkey/valkey:8-alpine`, CLI `valkey-cli`, biến `VALKEY_URL`.

---

## 2. Hiện thực Bất biến #1 — Tenant isolation = RLS + FORCE

**Mọi bảng có cột `company_id` PHẢI bật RLS + FORCE.** Cô lập ép ở tầng DB, không dựa kỷ luật dev. Áp template này trong migration (TRƯỚC mọi seed/backfill):

```sql
-- Template áp cho MỌI bảng nghiệp vụ có company_id
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE  ROW LEVEL SECURITY;   -- ép cả với owner role

CREATE POLICY tenant_isolation ON <table>
  USING      (company_id = current_setting('app.current_company_id')::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);

-- Bảng catalog dùng chung (company_id NULL = bản ghi hệ thống):
CREATE POLICY tenant_or_system ON <catalog_table>
  USING (company_id IS NULL OR company_id = current_setting('app.current_company_id')::uuid);
```

### 2.1 Set tenant context (BACKEND-01/03) — `withTenant`
Kết nối qua **PgBouncer transaction-mode**; mỗi giao dịch set context rồi chạy repository:

```ts
// db.service.ts (rút gọn)
export async function withTenant<T>(companyId: string, fn: (tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    // local = true => chỉ trong transaction hiện tại, an toàn trên pool dùng chung
    await tx.execute(sql`select set_config('app.current_company_id', ${companyId}, true)`);
    return fn(tx);
  });
}
```
- Pool LISTEN/NOTIFY + BullMQ dùng **kết nối direct riêng** (không qua PgBouncer transaction-mode).
- Repository KHÔNG nhận `company_id` từ body/header — chỉ từ auth context → `withTenant`.

---

## 3. Hiện thực Bất biến #2 — Audit append-only + Outbox

### 3.1 `audit_logs` append-only (ép ở tầng DB, không chỉ "đừng làm endpoint")
```sql
-- App role KHÔNG có quyền sửa/xóa audit
REVOKE UPDATE, DELETE ON audit_logs FROM app_role;

-- Chốt chặn cứng kể cả khi grant lỡ tay
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
```
> Khi build PAYROLL/finance (Phase 2): thêm `payslips`, `kpi_results` vào danh sách append-only tương tự.

### 3.2 Outbox transactional (audit + event đi cùng giao dịch nghiệp vụ)
```sql
CREATE TABLE outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  topic        text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unprocessed_idx ON outbox (created_at) WHERE processed_at IS NULL;
```
- Ghi audit + emit event = **INSERT vào `outbox` trong CÙNG transaction** với ghi dữ liệu nghiệp vụ → không mất event khi crash giữa chừng.
- `OutboxWorker` (đã có ở `scheduler`) đọc bản ghi `processed_at IS NULL`, publish sang Valkey/BullMQ, đánh dấu processed.
- **Thứ tự phụ thuộc**: outbox + audit phải tồn tại từ **Sprint 1**, trước module ghi dữ liệu đầu tiên (HR). Sửa roadmap tương ứng.

---

## 4. Tài liệu bị ảnh hưởng (đã gắn banner trỏ về đây)
FRONTEND-01/02/03/04/05/14 · BACKEND-01/02 · IMPLEMENTATION-04/05 · DEVOPS-01/03/05/06/07 · QA-01/04/06 · DB-01/07/08.
Các token an toàn (`NEXT_PUBLIC_`, Redis, Jest, Pytest) đã được thay inline; phần khái niệm (Next.js architecture, Prisma schema/commands) lấy tài liệu này làm chuẩn.
