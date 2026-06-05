# ADR-0004 — Envelope encryption + KMS/Vault cho `platform_accounts`

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0010](0010-permission-engine-4-tier.md), [0009](0009-audit-outbox-event-bus.md)

## Bối cảnh

Lưu mật khẩu/token tài khoản kênh (YouTube, TikTok…). Đây là secret giá trị cao, cần lộ lại được (reveal) cho role có quyền nhưng không bao giờ plaintext-at-rest/log.

## Quyết định

**Envelope encryption mã hóa phía APP**: DEK (data key) mã hóa dữ liệu, KEK (master key) ở **KMS/Vault** mã hóa DEK. **Không pgcrypto-in-SQL.** Reveal-secret yêu cầu **re-auth + ghi audit**. Secret không vào log, không vào DTO của role không quyền.

## Lý do

App-side encryption giữ KEK ngoài DB → kẻ chiếm DB dump không giải mã được. KMS/Vault cho phép rotation + break-glass. pgcrypto đặt key gần DB, lộ trong query/log.

## Hệ quả

Cần `kms-provisioning-and-rotation` (infra) + `secret-encryption-reviewer` + `envelope-encryption-auditor` + `sensitive-action-audit-hook`. Module G5e chỉ làm sau khi PermissionService xong (luật phụ thuộc).

## Phương án đã loại

- pgcrypto-in-SQL (key gần DB, rò log).
- Plaintext + cột "ẩn" (không bảo vệ thật).
- Lưu KEK trong env file trên cùng host (không rotation/audit).
