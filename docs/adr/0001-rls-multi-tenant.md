# ADR-0001 — RLS multi-tenant (FORCE RLS, app role non-superuser)

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0003](0003-pgbouncer-transaction-mode.md), [0009](0009-audit-outbox-event-bus.md), [0010](0010-permission-engine-4-tier.md)

## Bối cảnh

SaaS-ready, nhiều công ty (tenant) dùng chung 1 DB. Rò dữ liệu chéo tenant = lỗi chí mạng. Không thể dựa vào kỷ luật dev gắn `WHERE company_id` ở mọi query.

## Quyết định

Ép tenant isolation ở **tầng DB bằng PostgreSQL Row-Level Security**:

- `ENABLE ROW LEVEL SECURITY` + **`FORCE ROW LEVEL SECURITY`** trên mọi bảng nghiệp vụ.
- App kết nối bằng **DB role non-superuser**, **không BYPASSRLS**, **không owner bảng**.
- Mọi data-access đi qua wrapper `withTenant(companyId, fn)` set `app.current_company_id`.
- Policy dùng `current_setting('app.current_company_id')`.
- **Tạo policy + FORCE RLS TRƯỚC khi backfill `company_id`** (nếu không có cửa sổ rò chéo tenant).

## Lý do

RLS là phòng tuyến cuối ở DB, đúng cả khi dev quên `WHERE`. FORCE để chính owner cũng bị policy chặn. Non-superuser để không ai vô tình BYPASSRLS.

## Hệ quả

Mọi repository PHẢI qua `withTenant`. Test 2-tenant đối kháng là điều kiện done G2. Pool phải set context đúng cách (xem [ADR-0003](0003-pgbouncer-transaction-mode.md)).

## Phương án đã loại

- `WHERE company_id` thủ công — phụ thuộc kỷ luật, sẽ rò.
- **Supabase** — `service_role` bypass RLS, dễ rò; loại.
- DB-per-tenant — vận hành 100+ DB tốn kém, khó migrate.
