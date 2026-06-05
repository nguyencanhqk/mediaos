# ADR-0013 — Cache/Queue/Realtime = Valkey + BullMQ + Socket.IO

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** Trung bình
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0003](0003-pgbouncer-transaction-mode.md), [0012](0012-backend-nestjs-modular-monolith.md)

## Bối cảnh

Cần cache permission, hàng đợi job, presence, realtime chat/notification.

## Quyết định

**Valkey** (fork Redis, BSD) cho cache/queue/presence + **BullMQ** + **NestJS WebSocketGateway + Socket.IO + Valkey adapter**, room `co:{companyId}:…`.

## Lý do

Valkey tránh bẫy license **Redis 8 (AGPL)**. BullMQ chín muồi. Room theo `company_id` ép tenant isolation cả ở realtime.

## Hệ quả

Payload WS qua cùng DTO/masking như REST. Cần `realtime-test-harness` (lifecycle, presence cross-tenant, ordering). BullMQ/LISTEN-NOTIFY dùng pool direct ([ADR-0003](0003-pgbouncer-transaction-mode.md)).

## Phương án đã loại

- **Redis 8** — AGPL, rủi ro license.
- Kafka (nặng cho quy mô này).
