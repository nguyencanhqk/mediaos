# TikTok Integration Design

> **Trạng thái:** Designed — not built  
> **Ưu tiên:** P3 — sau YouTube/AdSense  
> **Auth type:** OAuth 2.0 Authorization Code (TikTok for Developers)

---

## 1. Mục tiêu / Objective

TikTok là nền tảng phân phối ngắn (short-form) thứ hai của MediaOS. Connector TikTok sẽ:

- **Đồng bộ metadata video** (title, cover URL, play count, like count, comment count, share count) vào `content_items` và `content_channels`.
- **Kéo doanh thu Creator Fund / TikTok Pulse** (nếu eligible) vào `revenue_records` với `source='tiktok'`.
- **Cập nhật follower count và tương tác** lên `channels.health_score`.
- Hỗ trợ **multi-account**: một công ty có thể có nhiều TikTok account kết nối vào nhiều kênh.

---

## 2. OAuth / Auth & Scopes

### Luồng

```
User → MediaOS UI → GET /auth/tiktok/connect
  → TikTok OAuth2 (Authorization Code, PKCE)
  → https://www.tiktok.com/v2/auth/authorize/
  → callback: exchange code → { access_token, refresh_token, open_id, expires_in }
  → lưu refresh_token vào platform_accounts (envelope-encrypted)
  → lưu open_id vào platform_accounts.account_identifier
```

### Scopes tối thiểu (TikTok Content Posting API + Research API)

| Scope | Mục đích |
|-------|----------|
| `user.info.basic` | Thông tin cơ bản account (display name, avatar) |
| `video.list` | Liệt kê video của account |
| `video.publish` | *(optional, chỉ nếu cần đăng video từ MediaOS)* |

> **Lưu ý:** TikTok Business API và Creator Marketplace API cần approval riêng. Revenue API (`creator_fund.readonly`) yêu cầu TikTok Business Center integration — cần apply riêng.

### Token lifecycle

- `access_token`: hết hạn sau **24 giờ** (TikTok v2).
- `refresh_token`: hết hạn sau **365 ngày** — dài hơn YouTube nhưng cũng cần renew.
- Lưu `refresh_token` vào `platform_accounts.secret_ciphertext` (envelope-encrypted, purpose='platform_account').
- Cache `access_token` Valkey TTL 23h.
- Khi refresh thất bại (`error_code=10003`): flip `platform_accounts.status='suspended'`, notify Channel Manager.

---

## 3. Rate-limit / Quota

| API | Limit |
|-----|-------|
| TikTok Content API v2 | 600 requests/phút per access_token |
| TikTok Research API | 1,000 requests/ngày per app |
| Video list | 20 video/page, tối đa 20 page/account |

**Chiến lược:**

1. BullMQ queue `tiktok-sync`, concurrency=2, rate-limit 5 req/giây per account.
2. Kéo video list incremental: lưu `cursor` pagination trong Valkey per account.
3. Exponential backoff khi nhận `4900002` (rate limit): base=10s, max=5 phút.
4. Không dùng `research_api` (cần separate app approval) cho routine sync — dùng `Content Posting API` + `user.info`.

---

## 4. Webhook vs Polling

TikTok không hỗ trợ PubSubHubbub. Polling.

- **Hourly sync** (`tiktok-hourly-sync`): BullMQ cron `0 * * * *` — kéo 50 video mới nhất per account.
- **Daily full sync** (`tiktok-daily-sync`): BullMQ cron `0 21 * * *` UTC (04:00 UTC+7) — kéo toàn bộ video 30 ngày gần nhất, cập nhật metrics.
- Dedup: idempotency key = `tiktok_video_id + account_open_id`; check `content_channels.publish_url` trước insert.

---

## 5. Mapping vào model MediaOS

### `platforms`

Seed đã có `code='tiktok'`. Không cần thêm.

### `platform_accounts`

| TikTok field | MediaOS column |
|-------------|----------------|
| `open_id` | `platform_accounts.account_identifier` |
| `display_name` | `platform_accounts.account_name` |
| `refresh_token` | `platform_accounts.secret_ciphertext` (envelope-encrypted) |
| — | `platform_accounts.platform_id → platforms.id` (tiktok) |

### `channels`

| TikTok field | MediaOS column |
|-------------|----------------|
| `open_id` (unique TikTok channel) | `channels.code` (prefix `tt:`) |
| `display_name` | `channels.name` |
| `follower_count` | `channels.health_note` hoặc `channels.health_score` (normalize) |

### `content_items`

| TikTok field | MediaOS column |
|-------------|----------------|
| `video_id` | `content_items.code` (`tt:{video_id}`) |
| `title` | `content_items.title` |
| `create_time` (epoch) | `content_items.published_at` |
| `cover_image_url` | `content_items.thumbnail_url` |
| Video URL | `content_items.final_url` |
| `duration` (giây) | **(new column — design only)** `content_items.duration_seconds integer` |

### `content_channels`

| TikTok field | MediaOS column |
|-------------|----------------|
| `status` (`PUBLISHED`) | `content_channels.publish_status='published'` |
| `share_url` | `content_channels.publish_url` |
| `create_time` | `content_channels.published_at` |

### `revenue_records` (append-only)

> **Note:** TikTok Creator Fund / Pulse revenue API truy cập hạn chế. Khi khả dụng:

| TikTok Revenue field | MediaOS column |
|---------------------|----------------|
| Earnings amount | `revenue_records.amount` |
| Currency | `revenue_records.currency` |
| Report date range | `revenue_records.period_start / period_end` |
| — | `revenue_records.source='tiktok'` |
| Channel | `revenue_records.channel_id` |

> **New column needed (shared với YouTube):** `revenue_records.external_ref_id text` — TikTok report job/batch ID **(design only)**.

### `channel_accounts` (M:N link)

Liên kết `channels` ↔ `platform_accounts` với `relation_type='tiktok_account'`.

---

## 6. Rủi ro bảo mật / Security risks

### Token storage

`refresh_token` TikTok lưu qua `SecretEncryptionService` (AES-256-GCM envelope):

```
encryptSecret(tiktokRefreshToken, { companyId, recordId: platformAccountId, purpose: 'platform_account' })
```

`open_id` là public identifier — lưu plaintext vào `account_identifier`.

### Danh sách rủi ro

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| `refresh_token` rò | CRITICAL | Envelope-encrypt + RLS + column-grant |
| `open_id` lộ → cross-account enum | MEDIUM | RLS tenant isolation; không expose open_id trong public API |
| API app credentials rò | HIGH | Lưu `APP_SECRET` qua env var + Vault; không log |
| Video analytics giả mạo (data integrity) | MEDIUM | Validate response schema Zod trước persist |
| Tenant cross-read | CRITICAL | `platform_accounts.company_id` + RLS FORCE |
| TikTok app bị ban (ToS) | MEDIUM | Tuân theo Content Posting API ToS; không scrape |

---

## 7. Thứ tự ưu tiên build / Build priority

**P3** — sau YouTube và AdSense.

Lý do:
- TikTok platform code đã có trong `platforms` seed và `channels` constraint.
- Connector logic tương tự YouTube nhưng API khác — có thể reuse BullMQ infrastructure.
- Revenue TikTok Creator Fund khó access hơn AdSense — có thể defer phần revenue, chỉ build metadata sync trước.
- `channel_accounts.relation_type='tiktok_account'` đã có trong CHECK constraint.

Dependencies: BullMQ infrastructure (G13 ✅), `platform_accounts` (G6-2 ✅), `channels`/`content_items` (G6 ✅).
