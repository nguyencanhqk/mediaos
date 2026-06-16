# YouTube Integration Design

> **Trạng thái:** Designed — not built  
> **Ưu tiên:** P1 — kết nối đầu tiên cần build (cốt lõi doanh thu)  
> **Auth type:** OAuth 2.0 Authorization Code + Google Service Account (analytics)

---

## 1. Mục tiêu / Objective

YouTube là nền tảng chính của MediaOS (~100 channel, ~300 video/tháng). Connector YouTube sẽ:

- **Đồng bộ metadata video** (title, status, publishedAt, viewCount, likeCount, commentCount, duration) vào `content_items` và `content_channels`.
- **Kéo doanh thu ước tính** từ YouTube Analytics / AdSense Revenue Report vào `revenue_records` (`source='youtube_adsense'`).
- **Cập nhật health score kênh** (subscriber count, average views, RPM) lên `channels.health_score / health_note`.
- **Webhook PubSubHubbub** để nhận thông báo video mới publish, giảm độ trễ sync xuống <5 phút.

---

## 2. OAuth / Auth & Scopes

### Luồng

```
User (Channel Manager) → MediaOS UI
  → /auth/google/connect (OAuth 2.0 Authorization Code, PKCE)
  → Google OAuth2 consent screen
  → callback: exchange code → { access_token, refresh_token, expires_in }
  → lưu token vào platform_accounts (envelope-encrypted, purpose='platform_account')
```

### Scopes tối thiểu

| Scope | Mục đích |
|-------|----------|
| `https://www.googleapis.com/auth/youtube.readonly` | Đọc metadata kênh, video, playlist |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | Kéo analytics (views, watch time) |
| `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` | Kéo doanh thu ước tính (estimated revenue) |

> **Tránh:** không request `youtube` (write) scope khi chỉ cần read.

### Token lifecycle

- `access_token`: hết hạn sau **1 giờ**.
- `refresh_token`: không có thời hạn cố định nhưng bị revoke nếu user đổi mật khẩu Google hoặc app bị revoke. MediaOS phải handle `invalid_grant` → cờ `status='suspended'` trên `platform_accounts` + cảnh báo Channel Manager.
- Lưu `refresh_token` vào `platform_accounts.secret_ciphertext` (envelope-encrypted). `access_token` là ephemeral — KHÔNG lưu DB, chỉ cache memory/Valkey TTL 50 phút.

---

## 3. Rate-limit / Quota

| API | Quota mặc định | Đơn vị |
|-----|---------------|--------|
| YouTube Data API v3 | 10,000 units/ngày | per project |
| YouTube Analytics API | 200 requests/100 giây | per user |
| YouTube Reporting API | N/A (bulk, file-based) | — |

**Chi phí units (Data API):**

| Operation | Cost |
|-----------|------|
| `channels.list` | 1 unit |
| `videos.list` | 1 unit |
| `playlistItems.list` | 1 unit |
| `search.list` | 100 units (**tránh dùng**) |

**Chiến lược:**

1. Tránh `search.list` — dùng `playlistItems.list(channelUploadsPlaylist)` để liệt kê video.
2. Batch `videos.list` với `id` comma-separated (tối đa 50 video/request).
3. BullMQ queue `youtube-sync` với concurrency=2, rate-limit 1 req/500ms per channel.
4. Exponential backoff khi nhận `429` hoặc `quotaExceeded`: base=2s, max=5 phút, jitter 10%.
5. Nếu quota ngày sắp hết (<500 units): pause queue, alert admin, resume sáng hôm sau (UTC+7 00:01).

---

## 4. Webhook vs Polling

### PubSubHubbub (push — ưu tiên)

- Đăng ký topic `https://www.youtube.com/xml/feeds/videos.xml?channel_id={yt_channel_id}` với Google's hub.
- Subscription hết hạn sau **10 ngày** → BullMQ scheduled job renew T-1 ngày.
- Nhận `POST /api/v1/webhooks/youtube` — validate `X-Hub-Signature` (HMAC-SHA1/SHA256 với secret).
- Payload chỉ cho biết video mới xuất hiện → trigger `videos.list` fetch metadata đầy đủ.
- Dedup: idempotency key = `yt_video_id + channel_id`; check `content_channels.publish_url` trước khi insert.

### Polling (fallback)

- Job `youtube-daily-sync` chạy mỗi đêm 02:00 UTC+7 (BullMQ cron `0 19 * * *` UTC).
- Đồng bộ 7 ngày gần nhất để bắt chỉnh sửa metadata.
- Revenue sync: kéo `yt-analytics` theo tháng, áp vào `revenue_records` với `periodStart/periodEnd`.

---

## 5. Mapping vào model MediaOS

### `platforms` (global)

- Đã có seed: `code='youtube'`. Không cần thêm.

### `channels`

| YouTube field | MediaOS column |
|--------------|----------------|
| `channelId` | `channels.code` (yt channel ID, e.g. `UCxxxxxx`) |
| `snippet.title` | `channels.name` |
| `statistics.subscriberCount` | `channels.health_score` (normalize /1M → 0–100) |
| Channel status active/inactive | `channels.status` |

FK: `channels.platform_id → platforms.id` (youtube).

### `platform_accounts`

| YouTube field | MediaOS column |
|--------------|----------------|
| Google account email | `platform_accounts.account_email` |
| OAuth `refresh_token` | `platform_accounts.secret_ciphertext` (envelope-encrypted) |
| `access_token` cache key | Valkey: `yt:token:{platform_account_id}` TTL 50m |
| — | `platform_accounts.platform_id → platforms.id` (youtube) |

### `content_items`

| YouTube field | MediaOS column |
|--------------|----------------|
| `videoId` | `content_items.code` (`yt:{videoId}`) |
| `snippet.title` | `content_items.title` |
| `snippet.publishedAt` | `content_items.published_at` |
| `status.uploadStatus` | `content_items.production_status` (`published`/`cancelled`) |
| `contentDetails.duration` | **(new column — design only)** `content_items.duration_seconds integer` |
| Video URL `https://youtu.be/{id}` | `content_items.final_url` |
| `thumbnails.high.url` | `content_items.thumbnail_url` |

### `content_channels`

| YouTube field | MediaOS column |
|--------------|----------------|
| YouTube publish status | `content_channels.publish_status` (`published`/`scheduled`/`failed`) |
| `https://youtu.be/{videoId}` | `content_channels.publish_url` |
| `snippet.publishedAt` | `content_channels.published_at` |

### `revenue_records` (append-only)

| YouTube Analytics field | MediaOS column |
|------------------------|----------------|
| `estimatedRevenue` (USD) | `revenue_records.amount` + `currency='USD'` |
| Report period | `revenue_records.period_start / period_end` |
| — | `revenue_records.source='youtube_adsense'` |
| `channelId` | `revenue_records.channel_id` |

> **New column needed:** `revenue_records.external_ref_id text` — lưu YouTube Analytics report job ID để dedup **(design only — không tạo migration)**.

### `channel_accounts` (M:N link)

Liên kết `channels` ↔ `platform_accounts` với `relation_type='main_google_account'` hoặc `'youtube_channel_account'`.

---

## 6. Rủi ro bảo mật / Security risks

### Token storage (envelope encryption)

OAuth `refresh_token` **phải** lưu qua `SecretEncryptionService` (apps/api/src/crypto/):

```
encryptSecret(refreshToken, { companyId, recordId: platformAccountId, purpose: 'platform_account' })
→ { secretCiphertext, encryptedDek, dekKeyVersion, kmsKeyId, ivNonce, authTag, encAlgo }
```

Các cột này ghi vào `platform_accounts`. DEK được wrap bởi KEK trong KMS/Vault (ADR-0004). Không bao giờ log `refresh_token` plaintext, không đưa vào DTO của role không đủ quyền.

### Danh sách rủi ro

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| `refresh_token` rò | CRITICAL | Envelope-encrypt + RLS + column-grant (không SELECT secret trừ reveal path) |
| Webhook giả mạo | HIGH | Validate `X-Hub-Signature` (HMAC) trước mọi xử lý |
| SSRF qua `finalUrl` | HIGH | Không dùng finalUrl để fetch outbound; chỉ lưu string |
| Quota exhaustion | MEDIUM | Rate-limit queue + alert khi <500 units |
| Token revoke silent | MEDIUM | Catch `invalid_grant`, flip `platform_accounts.status='suspended'`, notify |
| Wildcard scope creep | LOW | Chỉ request 3 scope tối thiểu; review khi thêm scope mới |
| Tenant cross-read | CRITICAL | RLS FORCE trên `platform_accounts` — `company_id` filter mọi query |

---

## 7. Thứ tự ưu tiên build / Build priority

**P1 — build đầu tiên** trong nhóm integration.

Lý do:
- YouTube là nguồn doanh thu chính (~80% revenue của media company VN).
- Connector YouTube unlock `revenue_records` tự động, giảm nhập tay.
- PubSubHubbub webhook cần test infra (endpoint public) — phải có CI/CD prod URL trước.
- AdSense connector (P2) phụ thuộc OAuth session đã thiết lập của YouTube (cùng Google account).

Dependencies: `platform_accounts` table (G6-2 ✅), `channels` (G6-1 ✅), `content_items` (G6-4 ✅), `revenue_records` (G13 ✅), `BullMQ` (G13 ✅).
