# ADR-0011 — Hạ tầng $0 + backup offsite

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** Thấp
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0014](0014-storage-r2-minio-s3.md)
- **Kế hoạch triển khai chi tiết (G0-5):** [`../infra-zero-cost-plan.md`](../infra-zero-cost-plan.md)

## Bối cảnh

Vận hành nội bộ trước, ngân sách ~0đ.

## Quyết định

Self-host trên **Oracle Cloud Always Free** hoặc **on-prem**. Backup `pg_dump` → **Backblaze B2 / Drive** (free tier) offsite. Health check sau deploy.

## Lý do

Đáp ứng ràng buộc chi phí 0đ mà vẫn có offsite backup (chống mất dữ liệu khi hỏng host). Stack tự chủ (Postgres/Valkey/MinIO) chạy được trên free tier.

## Hệ quả

Cần script backup + health check (`ecc:canary-watch`). Theo dõi giới hạn free tier. Có kế hoạch nâng cấp khi lên SaaS.

## Phương án đã loại

- Managed cloud trả phí (vượt ngân sách giai đoạn này).
- Supabase free (đã loại vì RLS bypass — [ADR-0001](0001-rls-multi-tenant.md)).
