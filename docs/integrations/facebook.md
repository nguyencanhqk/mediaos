# Facebook Integration Design

> **Trạng thái:** Designed — not built  
> **Ưu tiên:** P4 — Facebook Pages + Meta for Creators  
> **Auth type:** OAuth 2.0 Authorization Code (Facebook Login / Meta for Developers)

---

## 1. Mục tiêu / Objective

Facebook (Facebook Pages, Meta for Creators) là kênh phân phối bổ sung của MediaOS. Connector Facebook sẽ:

- **Đồng bộ bài đăng / video trên Facebook Page** (title, status, reach, reactions, shares, video views) vào `content_items` và `content_channels`.
- **Kéo doanh thu in-stream ads** (Facebook Creator Studio → Monetization insights) vào `revenue_records` với `source='facebook'`.
- **Cập nhật Page insights** (page follower count, reach, engagement rate) lên `channels.health_score`.
- Quản lý **Facebook Page Access Token** (long-lived, per-page) qua `platform_accounts`.

---

## 2. OAuth / Auth & Scopes

### Luồng

```
User → MediaOS UI → GET /auth/facebook/connect
  → Meta OAuth2 (User Token)
  → https://www.facebook.com/v20.0/dialog/oauth
  → callback: exchange code → short-lived User Token
  → exchange short-lived → long-lived User Token (60 ngày)
  → get Page list → user chọn Page → exchange User Token → Page Access Token (không hết hạn)
  → lưu Page Access Token vào platform_accounts (envelope-encrypted)
```

> **Page Access Token** (PAT) của Business Page không hết hạn nếu không bị thu hồi — khác với User Token. PAT là credential chính cần bảo vệ.

### Scopes tối thiểu

| Permission | Mục đích |
|------------|----------|
| `pages_read_engagement` | Đọc comments, reactions, reach |
| `pages_read_user_content` | Đọc posts/videos trên Page |
| `pages_show_list` | Liệt kê Pages của account |
| `read_insights` | Page Insights (reach, impressions) |
| `business_management` | *(optional)* Quản lý business assets |

> Meta Graph API permissions cần **App Review** cho một số permission. `pages_read_engagement` thường được approved trong 2–5 ngày business.

### Token lifecycle

- **Page Access Token (PAT):** không có `expires_in` cố định (non-expiring nếu user không revoke).
- Lưu PAT vào `platform_accounts.secret_ciphertext` (envelope-encrypted, purpose='platform_account').
- Không có refresh flow thông thường — nếu PAT bị revoke: flip `status='suspended'`, notify.
- Kiểm tra token validity bằng `GET /debug_token?input_token={PAT}&access_token={APP_TOKEN}` định kỳ (weekly cron).

---

## 3. Rate-limit / Quota

| Tier | Limit |
|------|-------|
| Meta Graph API | 200 calls/giờ per user, 200 calls/giờ per page |
| Business tier | 4,800 calls/giờ per app |
| Insights API | 10 req/giây per page |

**Chiến lược:**

1. BullMQ queue `facebook-sync`, concurrency=2, rate-limit 3 req/giây per page.
2. Khi nhận `(#4) Application request limit reached`: pause 15 phút.
3. Dùng `batch requests` (`/v20.0/?batch=[...]`) để gộp nhiều queries (tối đa 50 calls/batch).
4. Backoff: base=30s, max=1h khi nhận `OAuthException` code 17.

---

## 4. Webhook vs Polling

### Webhook (Meta Webhooks — ưu tiên)

- Đăng ký `Page` webhook object, topics: `feed` (new post), `mention`, `video_feed`.
- Meta gửi `POST /api/v1/webhooks/facebook` với HMAC-SHA256 signature (header `X-Hub-Signature-256`).
- Validate signature bằng `APP_SECRET` (lưu env var / Vault — KHÔNG lưu DB).
- Webhook cho biết có thay đổi → trigger fetch chi tiết bằng Graph API.
- Dedup: `page_post_id` idempotency key trong `content_channels.publish_url`.

### Polling (backup)

- **Daily sync** (`facebook-daily-sync`): BullMQ cron `0 21 * * *` UTC.
- Kéo 30 ngày posts, cập nhật insights metrics.

---

## 5. Mapping vào model MediaOS

### `platforms`

Seed đã có `code='facebook'`. Không cần thêm.

### `platform_accounts`

| Facebook field | MediaOS column |
|---------------|----------------|
| Page ID | `platform_accounts.account_identifier` |
| Page name | `platform_accounts.account_name` |
| Page Access Token | `platform_accounts.secret_ciphertext` (envelope-encrypted) |
| Admin email | `platform_accounts.account_email` |
| — | `platform_accounts.platform_id → platforms.id` (facebook) |

### `channels`

| Facebook field | MediaOS column |
|---------------|----------------|
| Page ID | `channels.code` (prefix `fb:{page_id}`) |
| Page name | `channels.name` |
| `fan_count` | `channels.health_score` (normalize /100K → 0–100) |
| `page_likes` | `channels.health_note` |

FK: `channels.platform_id → platforms.id` (facebook).

### `content_items`

| Facebook field | MediaOS column |
|---------------|----------------|
| `post_id` | `content_items.code` (`fb:{post_id}`) |
| `message` / `name` | `content_items.title` |
| `created_time` | `content_items.published_at` |
| `full_picture` | `content_items.thumbnail_url` |
| `permalink_url` | `content_items.final_url` |

### `content_channels`

| Facebook field | MediaOS column |
|---------------|----------------|
| Post status `published` | `content_channels.publish_status='published'` |
| `permalink_url` | `content_channels.publish_url` |
| `created_time` | `content_channels.published_at` |

### `revenue_records` (append-only)

> Revenue từ Facebook In-Stream Ads (Creator Studio Monetization):

| Facebook Monetization field | MediaOS column |
|---------------------------|----------------|
| `estimated_revenue` | `revenue_records.amount` |
| `USD` | `revenue_records.currency='USD'` |
| Report date range | `revenue_records.period_start / period_end` |
| — | `revenue_records.source='facebook'` |
| Page → channel | `revenue_records.channel_id` |

> **New column needed (shared):** `revenue_records.external_ref_id text` — Meta report ID **(design only)**.

### `channel_accounts` (M:N link)

`relation_type='facebook_page'`.

---

## 6. Rủi ro bảo mật / Security risks

### Token storage

Page Access Token (PAT) lưu qua `SecretEncryptionService`:

```
encryptSecret(pageAccessToken, { companyId, recordId: platformAccountId, purpose: 'platform_account' })
```

`APP_SECRET` (Meta app credential) lưu env var / Vault — không vào DB, không log.

### Webhook signature verification (BẮTBUỘC)

```
HMAC-SHA256(X-Hub-Signature-256) = hmac('sha256', APP_SECRET, rawBody)
```

Phải verify TRƯỚC khi xử lý bất kỳ webhook payload nào. Reject ngay nếu sai.

### Danh sách rủi ro

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| PAT rò → toàn quyền Page | CRITICAL | Envelope-encrypt + RLS + column-grant |
| `APP_SECRET` rò → giả mạo webhook | CRITICAL | Env var / Vault; không log; rotate định kỳ |
| Webhook giả mạo | HIGH | HMAC-SHA256 verify bắt buộc |
| PAT bị revoke không detect | MEDIUM | Weekly `/debug_token` check; flip suspended + notify |
| Meta App Review delay | LOW | Chuẩn bị App Review checklist sớm (2–5 ngày) |
| Tenant isolation | CRITICAL | RLS FORCE trên tất cả tables |

---

## 7. Thứ tự ưu tiên build / Build priority

**P4** — sau YouTube, AdSense, TikTok.

Lý do:
- Facebook `channels` code đã có trong platform seed và CHECK constraint.
- Connector pattern tương tự TikTok (OAuth + webhook) nhưng token lifecycle phức tạp hơn (User Token → Page Token exchange).
- Meta App Review cần thời gian → submit review request sớm ngay khi bắt đầu sprint.
- In-stream ads revenue thường nhỏ hơn YouTube AdSense với media company VN → có thể defer revenue sync, prioritize metadata sync.

Dependencies: BullMQ infra (G13 ✅), `platform_accounts` (G6-2 ✅), `channels`/`content_items` (G6 ✅).
