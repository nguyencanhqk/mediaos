# Integration Design — MediaOS (G16-4)

> **Trạng thái: THIẾT KẾ — chưa build.** Đây là tài liệu kế hoạch tích hợp (G16-4 Integration planning).
> Không có code/migration nào được tạo ở giai đoạn này. Mỗi connector chỉ được build khi tới lượt
> ưu tiên của nó và sau khi nền tảng phụ thuộc (G6-2 envelope encryption, G13 BullMQ, G2 auth) đã sẵn sàng.

MediaOS là hệ thống quản trị nội bộ công ty media (~200 nhân sự, 100 kênh, 300 video/tháng). Các đầu nối
bên ngoài đưa dữ liệu **doanh thu, nội dung và nhận diện** vào mô hình sẵn có (`platforms` · `channels` ·
`platform_accounts` · `content_items` · `content_channels` · `revenue_records` · `content_assets` ·
`notifications` · `users`). Mọi connector **tái dùng** hạ tầng đã có — KHÔNG dựng kiến trúc tích hợp thứ hai:
token lưu qua envelope-encryption (G6-2), polling qua BullMQ (G13), DTO qua `packages/contracts` (Zod),
cô lập tenant qua RLS FORCE.

## Thứ tự ưu tiên build

| # | Connector | Auth | Push / Pull | Mapping chính vào MediaOS | Trạng thái |
|---|-----------|------|-------------|---------------------------|-----------|
| **P1** | [YouTube](./youtube.md) | OAuth2 (Google) | Push (PubSubHubbub) + Poll fallback | `channels` · `content_items` · `revenue_records` | Designed — not built |
| **P2** | [AdSense](./adsense.md) | OAuth2 (Google, dùng lại session YouTube) | Poll | `revenue_records` (`source='youtube_adsense'`) | Designed — not built |
| **P3** | [TikTok](./tiktok.md) | OAuth2 (TikTok) | Poll (Research/Content API) | `channels` · `content_items` · `revenue_records` | Designed — not built |
| **P4** | [Facebook](./facebook.md) | OAuth2 (Meta, User→Page token) | Push (Meta Webhooks) + Poll | `channels` · `content_items` · `revenue_records` | Designed — not built |
| **P5** | [Google Drive](./google-drive.md) | OAuth2 (Google, dùng lại infra) | Push (Drive notifications) + Poll | `content_assets` (`external_id` — design only) | Designed — not built |
| **P6a** | [Email — transactional](./email.md) | SMTP / API key (Resend/SES/SendGrid) | Delivery webhook | `notifications` | Designed — buildable sớm (song song G16-1) |
| **P6b** | [Email — Gmail inbox](./email.md) | OAuth2 (Gmail) | Push (Cloud Pub/Sub) + Poll | Inbound email → task (new table — design only) | Designed — deferred |
| **P7** | [SSO](./sso.md) | OIDC / SAML 2.0 | — (login redirect) | `users` (identity link) · `companies` (feature flag) · `platform_accounts` (IdP config) | Designed — G16-3 SaaS context |

**Lý do thứ tự:** doanh thu trước (P1–P4: YouTube là ~80% revenue → mở khóa OAuth Google dùng chung cho AdSense
và Drive), rồi asset management (P5), rồi hạ tầng email (P6a có thể build sớm vì không cần OAuth), cuối cùng SSO
(P7) thuộc gói SaaS-prep cho khách enterprise. Chi tiết phụ thuộc nằm ở mục 7 mỗi doc.

## Nguyên tắc nền tảng tích hợp (áp dụng cho MỌI connector)

1. **Token storage = envelope encryption (G6-2, BẤT BIẾN #3).** Mọi `refresh_token` / client secret / SMTP
   password / SAML private key lưu qua `SecretEncryptionService.encryptSecret(..., { companyId, recordId,
   purpose: 'platform_account' })` → các cột envelope trong `platform_accounts`. DEK wrap bởi KEK ở KMS/Vault
   (ADR-0004). **Không bao giờ** log plaintext, không đưa vào DTO của role không đủ quyền (column-grant +
   reveal-path + re-auth như G6-2).
2. **Cô lập tenant.** Mọi config/credential connector gắn `company_id` + RLS FORCE. Không share token/subject
   giữa tenant (vd SSO: unique `(company_id, sso_provider, sso_subject)`).
3. **Polling qua BullMQ (G13), không cron rời rạc.** Mỗi job idempotent (dedup theo external id), backoff khi
   rate-limit, alert khi sắp cạn quota.
4. **Webhook phải verify chữ ký TRƯỚC khi xử lý** (HMAC `X-Hub-Signature` / Meta / provider; Google-signed JWT
   cho Pub/Sub). Không tin payload chưa xác thực. Chống SSRF trên mọi URL outbound (không fetch theo URL do
   bên ngoài cung cấp).
5. **DTO qua `packages/contracts` (Zod = nguồn sự thật).** Dữ liệu external validate ở biên trước khi vào DB.
6. **Audit khi connect/disconnect/revoke.** Gắn/gỡ tài khoản kênh là hành động nhạy cảm → `audit_logs`
   (ai/khi/scope, không log secret). Revoke (`invalid_grant`) → flip `platform_accounts.status` + notify, không
   nuốt lỗi im lặng.
7. **Scope tối thiểu.** Chỉ xin scope cần thiết; review mỗi lần thêm scope. Gmail/Drive restricted scope cần
   Google App Verification — chuẩn bị sớm.

## Bảo mật & 2FA cross-cut

- SSO login (P7) **phải** đi qua `TwoFactorService` nếu `roles.requires_two_factor=true` — không bypass 2FA.
- Email enumeration / bounce: rate-limit, không lộ chi tiết bounce.
- Mọi connector revenue ghi vào `revenue_records` (append-only) — không UPDATE/DELETE; reconcile bằng bản ghi mới.

## Tài liệu connector

- [YouTube](./youtube.md) · [AdSense](./adsense.md) · [TikTok](./tiktok.md) · [Facebook](./facebook.md) ·
  [Google Drive](./google-drive.md) · [Email](./email.md) · [SSO](./sso.md)
