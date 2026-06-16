# AdSense Integration Design

> **Trạng thái:** Designed — not built  
> **Ưu tiên:** P2 — theo sau YouTube (cùng Google OAuth session)  
> **Auth type:** OAuth 2.0 Authorization Code (shared Google session với YouTube connector)

---

## 1. Mục tiêu / Objective

Google AdSense cung cấp báo cáo doanh thu **cấp đơn vị quảng cáo** chi tiết hơn YouTube Analytics. Connector AdSense sẽ:

- Kéo **báo cáo doanh thu AdSense** (earnings, RPM, impressions, CTR) theo kênh và theo ngày/tháng.
- So sánh chéo với doanh thu YouTube Analytics để **reconcile** (phát hiện chênh lệch).
- Ánh xạ AdSense ad unit → MediaOS channel → `revenue_records` với `source='youtube_adsense'` (cùng source enum, phân biệt bằng `description` hoặc column mới `sub_source`).
- Hỗ trợ thanh toán tháng: đồng bộ `payments` từ AdSense → tạo `revenue_records` với `entry_kind='original'` khi xác nhận thanh toán.

---

## 2. OAuth / Auth & Scopes

### Luồng

AdSense dùng cùng **Google OAuth session** với YouTube. Nếu user đã kết nối YouTube (đã có `platform_accounts` record cho Google account đó), chỉ cần **re-consent** thêm AdSense scope — không cần tạo `platform_accounts` mới.

```
GET /auth/google/adsense/connect
  → incremental authorization (thêm scope vào existing Google session)
  → lưu scope list mở rộng vào platform_accounts.account_identifier (JSON metadata)
```

### Scopes tối thiểu

| Scope | Mục đích |
|-------|----------|
| `https://www.googleapis.com/auth/adsense.readonly` | Đọc báo cáo doanh thu, ad unit metadata |

> Không request `adsense` (write) — không cần tạo/sửa ad unit.

### Token lifecycle

- Dùng chung `refresh_token` đã lưu trong `platform_accounts` (Google account). Không tạo record mới.
- `access_token` ephemeral: cache Valkey TTL 50 phút.

---

## 3. Rate-limit / Quota

| API | Quota |
|-----|-------|
| AdSense Management API v2 | 10,000 requests/ngày, 10 requests/giây |

**Chiến lược:**

1. Báo cáo AdSense chạy **batch hàng ngày** (BullMQ cron 03:00 UTC+7).
2. Không cần realtime — dữ liệu AdSense thường trễ 24–48 giờ.
3. Chỉ kéo incremental: từ ngày cuối đã sync đến hôm qua.
4. Retry với exponential backoff (base=5s, max=10 phút) khi nhận `429`.

---

## 4. Webhook vs Polling

AdSense **không hỗ trợ webhook**. Dùng polling thuần.

- **Daily sync job** (`adsense-daily-sync`): BullMQ cron `0 20 * * *` UTC (03:00 UTC+7).
- Kéo báo cáo tháng hiện tại + tháng trước (để reconcile cuối tháng).
- Dedup: `revenue_records` có unique constraint ngầm qua `replaces_record_id` chain — kiểm tra `period_start + period_end + channel_id + source='youtube_adsense'` trước khi insert; nếu đã tồn tại thì insert `adjustment` thay `original`.

---

## 5. Mapping vào model MediaOS

### `platforms`

Seed đã có `code='youtube'`. AdSense là một **sub-service của Google/YouTube** — không cần platform riêng. Dùng `platforms.code='youtube'` cho AdSense records.

### `platform_accounts`

Tái dùng record `platform_accounts` của Google account (đã có từ YouTube connector). Bổ sung metadata:

| AdSense field | MediaOS column |
|--------------|----------------|
| AdSense publisher ID (`pub-XXXXXX`) | `platform_accounts.account_identifier` (JSON: `{"adsense_pub_id":"pub-xxx"}`) |

> **Note:** `account_identifier` là `text` — lưu JSON string nếu cần nhiều identifiers. Cân nhắc thêm column riêng nếu trường hợp sử dụng mở rộng **(design only)**.

### `channels`

AdSense ad unit → map theo channel thông qua YouTube channel ID (đã có trong `channels.code`).

### `revenue_records` (append-only)

| AdSense Report field | MediaOS column |
|---------------------|----------------|
| `earnings` | `revenue_records.amount` |
| `USD` | `revenue_records.currency='USD'` |
| Report date | `revenue_records.revenue_date` |
| `date_range.start` | `revenue_records.period_start` |
| `date_range.end` | `revenue_records.period_end` |
| — | `revenue_records.source='youtube_adsense'` |
| AdSense ad unit → channel | `revenue_records.channel_id` |
| — | `revenue_records.description` = `"AdSense: {adUnitName}"` |
| Report job ID | **(new column — design only)** `revenue_records.external_ref_id text` |

> **Reconcile flow:** nếu revenue_records đã tồn tại cho cùng period+channel → insert bản `entry_kind='adjustment'` với `replaces_record_id` trỏ bản gốc. Không bao giờ UPDATE/DELETE (bất biến #2).

---

## 6. Rủi ro bảo mật / Security risks

### Token storage

AdSense dùng chung `platform_accounts` record và `refresh_token` đã envelope-encrypt (xem [youtube.md § 6](./youtube.md)). Không cần lưu credential mới.

### Danh sách rủi ro

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| Rò publisher ID + earnings | HIGH | RLS trên `revenue_records` (company_id); không expose trong public API |
| Double-import → financial inflation | HIGH | Dedup bắt buộc trước mỗi insert; unique constraint `replaces_record_id` |
| Dữ liệu trễ → reconcile sai | MEDIUM | Luôn kéo lại tháng hiện tại + tháng trước; mark `description` rõ ràng |
| Scope creep | LOW | Chỉ `adsense.readonly`; review nếu thêm write scope |
| Tenant isolation | CRITICAL | `revenue_records.company_id` + RLS FORCE (bất biến #1) |

---

## 7. Thứ tự ưu tiên build / Build priority

**P2** — build ngay sau YouTube connector.

Lý do:
- Phụ thuộc OAuth session YouTube (cùng Google account) → Google OAuth infrastructure phải có trước.
- Dữ liệu AdSense bổ sung YouTube Analytics: cùng `revenue_records` table, cùng `source='youtube_adsense'`.
- Reconcile cuối tháng là use case tài chính quan trọng (so khớp `revenue_records` vs AdSense payments).

Dependencies: YouTube connector (Google OAuth infra), `revenue_records` (G13 ✅), `platform_accounts` (G6-2 ✅).
