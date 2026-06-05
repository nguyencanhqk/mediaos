# ADR-0014 — Storage = Cloudflare R2 / MinIO qua S3 SDK

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** Thấp
- **Liên quan:** [0011](0011-zero-cost-infra.md)

## Bối cảnh

Lưu file video/tài liệu nộp việc.

## Quyết định

**Cloudflare R2** (hoặc **MinIO** self-host) qua `@aws-sdk/client-s3`.

## Lý do

R2 không tính egress (rẻ cho media). S3 SDK chuẩn → đổi R2↔MinIO không sửa code. MinIO chạy được trên hạ tầng $0 ([ADR-0011](0011-zero-cost-infra.md)).

## Hệ quả

Cấu hình endpoint/credentials qua env. Presigned URL cho upload/download.

## Phương án đã loại

- AWS S3 (egress đắt).
- Lưu file trong DB (sai mục đích, phình DB).
