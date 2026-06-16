# Email Integration Design

> **Trạng thái:** Designed — not built  
> **Ưu tiên:** P6 — internal comms & notification delivery  
> **Auth type:** OAuth 2.0 (Gmail API) hoặc SMTP credentials (mã hóa) cho transactional email

---

## 1. Mục tiêu / Objective

Email integration phục vụ hai mục đích tách biệt trong MediaOS:

**1. Transactional email** (outbound, hệ thống gửi):
- Gửi thông báo hệ thống: approval request, task assignment, payslip ready, alert bảo mật.
- Gửi invite nhân viên mới, reset password, 2FA enrollment.
- Provider: SMTP relay (Resend / AWS SES / SendGrid) qua env config — không cần OAuth.

**2. Gmail inbox monitoring** (inbound, tùy chọn):
- Đọc email từ inbox Gmail kênh (e.g. `channel@company.com`) để phát hiện yêu cầu hợp tác, sponsorship lead.
- Forward email quan trọng thành `notifications` hoặc task trong MediaOS.
- Yêu cầu OAuth Gmail API.

---

## 2. OAuth / Auth & Scopes

### 2a. Transactional email (SMTP / API key)

Không dùng OAuth. Lưu SMTP credentials hoặc API key provider:

```
SMTP_HOST, SMTP_PORT, SMTP_USER → env vars
SMTP_PASS hoặc PROVIDER_API_KEY → lưu platform_accounts (envelope-encrypted)
```

| Field | Lưu ở đâu |
|-------|-----------|
| Provider (resend/ses/sendgrid) | `platform_accounts.account_identifier` |
| SMTP user / sender email | `platform_accounts.account_email` |
| SMTP password hoặc API key | `platform_accounts.secret_ciphertext` (envelope-encrypted, purpose='platform_account') |

### 2b. Gmail inbox monitoring (OAuth)

```
User → GET /auth/google/gmail/connect
  → Google OAuth2
  → Consent: Gmail scopes
  → lưu refresh_token vào platform_accounts
```

#### Scopes Gmail tối thiểu

| Scope | Mục đích |
|-------|----------|
| `https://www.googleapis.com/auth/gmail.readonly` | Đọc inbox (metadata + body) |
| `https://www.googleapis.com/auth/gmail.modify` | Đánh dấu read, label |

> **Hạn chế:** `gmail.readonly` là **restricted scope** — cần Google App Verification (có thể mất 4–6 tuần). Cân nhắc defer tính năng này hoặc dùng **Google Workspace** + service account.

### Token lifecycle (Gmail OAuth)

- `refresh_token` → envelope-encrypt vào `platform_accounts`.
- `access_token`: 1h, cache Valkey.

---

## 3. Rate-limit / Quota

### Transactional email

| Provider | Limit (free tier) |
|----------|------------------|
| Resend | 3,000 emails/tháng, 100/ngày |
| AWS SES | 62,000 emails/tháng (EC2), 0.10 USD/1000 |
| SendGrid | 100 emails/ngày free, 40,000/tháng (paid) |

Với ~200 nhân sự: ước ~500–1,000 emails/ngày (thông báo + approval) → cần paid tier hoặc AWS SES.

**Chiến lược:**

1. BullMQ queue `email-send` — rate-limit 10 emails/giây.
2. Retry tối đa 3 lần với exponential backoff (1s, 10s, 60s) cho delivery failure.
3. Tracking delivery status (webhook callback từ provider) → update `notifications` record.

### Gmail API

| API | Limit |
|-----|-------|
| Gmail API | 1,000,000,000 quota units/ngày; `messages.list` = 5 units/request |

---

## 4. Webhook vs Polling

### Gmail Push (Pub/Sub — ưu tiên cho inbox monitor)

- `users.watch()` → Google Cloud Pub/Sub topic → MediaOS subscriber.
- Subscription cần Google Cloud project với Pub/Sub enabled.
- Notification push → `POST /api/v1/webhooks/gmail-pubsub` (Cloud Pub/Sub push endpoint).
- Validate bằng Google-signed JWT trong `Authorization` header.
- Dedup: `history_id` incremental — lưu last processed `historyId` per account (Valkey).

### Polling (fallback / khi không có Cloud Pub/Sub)

- **15-minute poll** (`gmail-inbox-poll`): BullMQ cron `*/15 * * * *`.
- Dùng `messages.list(q='is:unread after:{lastSync}')` → fetch metadata → filter relevant.

### Transactional email delivery webhook

- Provider (Resend/SES/SendGrid) callback `POST /api/v1/webhooks/email-delivery`.
- Events: `delivered`, `bounced`, `complained`, `opened`, `clicked`.
- Validate signature của provider trước xử lý.
- Update `notifications.is_read` hoặc tạo system alert nếu bounce rate cao.

---

## 5. Mapping vào model MediaOS

### `platforms`

Cần thêm khi build:
- `platforms.code='email'` **(new seed — design only)**.
- Cập nhật CHECK constraint **(migration mới — design only)**.

### `platform_accounts`

| Email field | MediaOS column |
|------------|----------------|
| Provider (resend/ses/sendgrid) | `platform_accounts.account_identifier` |
| Sender email / SMTP user | `platform_accounts.account_email` |
| SMTP password / API key | `platform_accounts.secret_ciphertext` (envelope-encrypted) |
| Gmail OAuth refresh_token | `platform_accounts.secret_ciphertext` (envelope-encrypted, riêng cho Gmail account) |
| — | `platform_accounts.platform_id → platforms.id` (email) |

### `notifications` (bảng hiện tại)

Notifications hệ thống đã có (`communication.ts`). Email connector **ghi vào `notifications`** sau khi gửi email thành công để tạo audit trail:

| Email field | MediaOS column |
|------------|----------------|
| Recipient user | `notifications.user_id` |
| Email type | `notifications.type` (e.g. `general`, `approval_requested`) |
| Subject | `notifications.body` |
| — | `notifications.ref_id / ref_type` (link to approval/task) |

### Inbound email → task/notification **(new table — design only)**

Nếu build Gmail inbox monitor, cần `inbound_emails` table để track email đã xử lý:

```
inbound_emails (design only):
  id uuid PK
  company_id uuid (RLS)
  gmail_message_id text UNIQUE
  from_address text
  subject text
  received_at timestamp
  processed_at timestamp
  result_type text ('ignored','task_created','notification_created')
  result_ref_id uuid
  created_at timestamp
```

---

## 6. Rủi ro bảo mật / Security risks

### Credential storage

SMTP password và Gmail `refresh_token` lưu qua `SecretEncryptionService`:

```
encryptSecret(smtpPasswordOrToken, { companyId, recordId: platformAccountId, purpose: 'platform_account' })
```

API key provider (Resend/SES/SendGrid): tương tự.

### Email-specific risks

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| SMTP credentials rò → spam relay | CRITICAL | Envelope-encrypt; không log; RLS |
| Gmail OAuth → đọc toàn bộ inbox | HIGH | Scope tối thiểu `gmail.readonly`; App Verification trước production |
| Email spoofing (From header) | HIGH | Validate SPF/DKIM/DMARC cho sending domain; chỉ dùng verified sender |
| Pub/Sub JWT giả mạo | HIGH | Validate Google-signed JWT (audience check) |
| Delivery webhook giả mạo | MEDIUM | HMAC signature validation của provider |
| PII trong email body | HIGH | Không log full email body; chỉ log metadata; GDPR consideration |
| Bounce → khai thác email enum | LOW | Rate-limit `/forgot-password`; không expose bounce detail |
| Gmail `readonly` restricted scope | MEDIUM | Chuẩn bị Google App Verification sớm; hoặc dùng service account với Workspace |

---

## 7. Thứ tự ưu tiên build / Build priority

**P6 — chia 2 sub-task:**

- **P6a (Transactional email):** Build sớm — cần ngay cho approval notify, payslip, 2FA. Chỉ cần SMTP/API key, không cần OAuth. SMTP credentials đơn giản hơn.
- **P6b (Gmail inbox monitor):** Defer — cần Google App Verification, Cloud Pub/Sub setup, business case rõ ràng (sponsorship lead tracking).

**P6a** thực ra có thể build song song với G16-1 (hardening) — chỉ là infrastructure email delivery.

Dependencies: `notifications` table (G10 ✅ G15), `platform_accounts` (G6-2 ✅), BullMQ (G13 ✅).
