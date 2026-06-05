# Architecture Decision Records — MediaOS

> Mỗi ADR ghi 1 quyết định kiến trúc bất khả nghịch. Định dạng: **Bối cảnh · Quyết định · Lý do · Hệ quả · Phương án đã loại**.
> Bản hợp nhất + bối cảnh tổng: [`../../TECH-DECISION-RECORD.md`](../../TECH-DECISION-RECORD.md). Hợp đồng vận hành: [`../../CLAUDE.md`](../../CLAUDE.md).

## Index

| #                                                  | Quyết định                                                    | Trạng thái  | Bất khả nghịch |
| -------------------------------------------------- | ------------------------------------------------------------- | ----------- | :------------: |
| [0001](0001-rls-multi-tenant.md)                   | RLS multi-tenant (FORCE RLS, app role non-superuser)          | ✅ Accepted |     ⚠️ Cao     |
| [0002](0002-orm-drizzle.md)                        | ORM = Drizzle (loại Prisma)                                   | ✅ Accepted |     ⚠️ Cao     |
| [0003](0003-pgbouncer-transaction-mode.md)         | Pooling = PgBouncer transaction-mode + `set_config(...,true)` | ✅ Accepted |     ⚠️ Cao     |
| [0004](0004-envelope-encryption-kms.md)            | Envelope encryption + KMS/Vault cho `platform_accounts`       | ✅ Accepted |     ⚠️ Cao     |
| [0005](0005-immutable-payroll-finance-snapshot.md) | Payroll/Finance = snapshot bất biến (append-only)             | ✅ Accepted |     ⚠️ Cao     |
| [0006](0006-frontend-vite-react-spa.md)            | Frontend = Vite + React SPA (1 trust boundary)                | ✅ Accepted |   Trung bình   |
| [0007](0007-mobile-react-native.md)                | Mobile = React Native                                         | ✅ Accepted |   Trung bình   |
| [0008](0008-timezone-utc-at-rest.md)               | Timezone UTC-at-rest, render `Asia/Ho_Chi_Minh`               | ✅ Accepted |     ⚠️ Cao     |
| [0009](0009-audit-outbox-event-bus.md)             | Audit log bất biến + transactional outbox + event bus         | ✅ Accepted |     ⚠️ Cao     |
| [0010](0010-permission-engine-4-tier.md)           | Permission engine 4 tầng, quyền nhạy cảm KHÔNG kế thừa        | ✅ Accepted |     ⚠️ Cao     |
| [0011](0011-zero-cost-infra.md)                    | Hạ tầng $0 (Oracle Always Free / on-prem) + backup offsite    | ✅ Accepted |      Thấp      |
| [0012](0012-backend-nestjs-modular-monolith.md)    | Backend = NestJS modular monolith, contracts Zod              | ✅ Accepted |   Trung bình   |
| [0013](0013-valkey-bullmq-socketio.md)             | Cache/Queue/Realtime = Valkey + BullMQ + Socket.IO            | ✅ Accepted |   Trung bình   |
| [0014](0014-storage-r2-minio-s3.md)                | Storage = Cloudflare R2 / MinIO qua S3 SDK                    | ✅ Accepted |      Thấp      |
| [0015](0015-ui-shadcn-tanstack.md)                 | UI = shadcn/ui + Tailwind v4 + TanStack Table                 | ✅ Accepted |      Thấp      |
| [0016](0016-approval-single-source-of-truth.md)    | Approval = nguồn sự thật duy nhất (`approval_requests`); step là projection | ✅ Accepted |     ⚠️ Cao     |

> **⚠️ Bất khả nghịch Cao** = đổi sau MVP phải đập đi làm lại nền. Chốt kỹ TRƯỚC khi code.

## Quy ước

- Thêm ADR mới: tạo `NNNN-<kebab-title>.md`, thêm dòng vào bảng trên.
- Không sửa nội dung ADR đã Accepted; nếu đảo quyết định → tạo ADR mới `Supersedes NNNN` và đổi trạng thái ADR cũ thành `Superseded by MMMM`.
