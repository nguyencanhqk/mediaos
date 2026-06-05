# ADR-0009 — Audit log bất biến + transactional outbox + event bus nội bộ

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0002](0002-orm-drizzle.md), [0003](0003-pgbouncer-transaction-mode.md), [0005](0005-immutable-payroll-finance-snapshot.md)

## Bối cảnh

Mọi hành động quan trọng cần audit; cần phát event nội bộ (notification, chat, task) đáng tin, không mất.

## Quyết định

**Audit log append-only** + **transactional outbox** (ghi event cùng transaction nghiệp vụ) + **event bus nội bộ** idempotent. Dead-letter + **alert khi drop**.

## Lý do

Outbox đảm bảo "ghi nghiệp vụ thành công ⟺ event được phát" (không mất, không nhân đôi nếu idempotent). Audit bất biến = bằng chứng. PHẢI có TRƯỚC mọi module (luật phụ thuộc).

## Hệ quả

Cần `event-outbox-audit-guide` + `ecc:silent-failure-hunter`. Alerting runtime cho audit/event-dispatch drop (dead-letter + cảnh báo). Worker đọc outbox qua pool direct (xem [ADR-0003](0003-pgbouncer-transaction-mode.md)).

## Phương án đã loại

- Phát event trực tiếp trong code (mất event nếu transaction rollback hoặc crash).
- Chỉ log không outbox (không tin cậy phân phối).
