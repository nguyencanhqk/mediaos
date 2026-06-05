# ADR-0003 — Pooling = PgBouncer transaction-mode + `set_config(...,true)`

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0002](0002-orm-drizzle.md), [0009](0009-audit-outbox-event-bus.md), [0013](0013-valkey-bullmq-socketio.md)

## Bối cảnh

Nhiều kết nối đồng thời, cần pooling. Nhưng RLS dựa trên session GUC `app.current_company_id` — nếu set ở session-level mà connection bị tái dùng cho tenant khác → rò chéo.

## Quyết định

**PgBouncer ở transaction-mode**. Set context bằng `set_config('app.current_company_id', $1, true)` — tham số thứ 3 = `true` nghĩa là **local trong transaction**, tự reset khi transaction kết thúc. Riêng **LISTEN/NOTIFY và BullMQ dùng pool direct riêng** (không qua PgBouncer transaction-mode vì cần session bền).

## Lý do

Transaction-mode + `local=true` đảm bảo context tenant chỉ sống trong transaction → không rò khi PgBouncer tái dùng connection. `withTenant` mở transaction, set local config, chạy `fn`, commit.

## Hệ quả

Mọi data-access phải nằm trong transaction (đúng với `withTenant`). Prepared statements phải cấu hình tương thích transaction-mode. CI phải assert thứ tự RLS-trước-backfill và assert PgBouncer×RLS không rò.

## Phương án đã loại

- Session-mode pooling — context rò qua connection tái dùng.
- Set GUC session-level — cùng vấn đề.
