# ADR-0012 — Backend = NestJS modular monolith, contracts Zod

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** Trung bình
- **Liên quan:** [0002](0002-orm-drizzle.md), [0006](0006-frontend-vite-react-spa.md), [0013](0013-valkey-bullmq-socketio.md)

## Bối cảnh

Cần backend có cấu trúc, API-first, SaaS-ready, dễ tách module sau.

## Quyết định

**NestJS + TypeScript, modular monolith.** Validate input bằng `nestjs-zod`. `packages/contracts` (Zod) = **nguồn sự thật DTO**, chia sẻ FE/BE. Response envelope + global error filter + validation pipe.

## Lý do

Modular monolith đơn giản hơn microservices cho quy mô này nhưng vẫn tách module rõ để tách sau. Zod 1 nguồn cho cả runtime-validation lẫn type. Business logic ở Service, không ở Controller.

## Hệ quả

Mọi DTO/masking REST **và** WebSocket dùng chung layer (cấm `io.emit` thẳng row). File nhỏ 200–400 dòng (max 800), tổ chức theo feature.

## Phương án đã loại

- Microservices ngay từ đầu (over-engineering).
- Express thuần (thiếu cấu trúc).
- class-validator-only (không chia sẻ schema với FE tốt như Zod).
