# Google Drive Integration Design

> **Trạng thái:** Designed — not built  
> **Ưu tiên:** P5 — asset management (sau các connector doanh thu)  
> **Auth type:** OAuth 2.0 Authorization Code (Google Workspace / personal account)

---

## 1. Mục tiêu / Objective

Google Drive là nơi lưu trữ asset sản xuất của ~200 nhân sự MediaOS (script, video raw, edited video, thumbnail). Connector Drive sẽ:

- **Liên kết asset trên Drive** (script, raw video, edited video, thumbnail) với `content_assets` trong MediaOS — không copy file, chỉ lưu Drive URL/ID.
- **Tự động detect file mới** được upload vào thư mục dự án → tạo/cập nhật `content_assets` record.
- **Sync trạng thái** (file exists, last modified, owner) để phát hiện file bị xóa hoặc di chuyển.
- Hỗ trợ **sharing link** → lưu `external_url` vào `content_assets` để reviewer xem trực tiếp từ MediaOS.

---

## 2. OAuth / Auth & Scopes

### Luồng

```
User (hoặc service account) → GET /auth/google/drive/connect
  → Google OAuth2 Authorization Code (PKCE)
  → Consent: Google Drive scopes
  → callback: { access_token, refresh_token }
  → lưu refresh_token vào platform_accounts (envelope-encrypted, purpose='platform_account')
```

Hoặc dùng **Service Account** (Google Workspace) nếu công ty có Google Workspace:

```
Service Account JSON key → lưu private_key (envelope-encrypted) vào platform_accounts
→ impersonate domain users (Domain-wide delegation)
```

> Ưu tiên OAuth user account cho công ty không dùng Workspace; service account cho Workspace.

### Scopes tối thiểu

| Scope | Mục đích |
|-------|----------|
| `https://www.googleapis.com/auth/drive.readonly` | Đọc metadata và nội dung file |
| `https://www.googleapis.com/auth/drive.metadata.readonly` | Chỉ metadata (nếu không cần tải file) |

> **Tránh** `drive` (full write) — MediaOS chỉ cần đọc và tạo sharing link, không cần write.  
> Nếu cần tạo folder tự động: thêm `drive.file` scope (chỉ files mà app tạo ra).

### Token lifecycle

- Cùng Google account với YouTube connector → có thể reuse `platform_accounts` record.
- `access_token`: 1 giờ. `refresh_token`: non-expiring.
- Lưu `refresh_token` envelope-encrypted trong `platform_accounts.secret_ciphertext`.
- Service account: lưu encrypted JSON key string vào `secret_ciphertext`.

---

## 3. Rate-limit / Quota

| API | Limit |
|-----|-------|
| Drive API v3 | 1,000 requests/100 giây per user, 10,000 requests/ngày |
| Files: `list` | 100 items/page |
| Files: `get` (metadata) | 1 unit |
| Files: `watch` (push) | 1 unit per channel |

**Chiến lược:**

1. Dùng `files.list` với `q` filter (thư mục dự án + modifiedTime) thay vì full scan.
2. Lưu `pageToken` cho incremental sync.
3. BullMQ queue `drive-sync`, rate-limit 5 req/giây.
4. Exponential backoff khi `403 User Rate Limit Exceeded`: base=5s, max=5 phút.

---

## 4. Webhook vs Polling

### Drive Push Notifications (ưu tiên cho thư mục được theo dõi)

- `POST /drive/v3/files/{folderId}/watch` → Google gửi `POST /api/v1/webhooks/drive`.
- Notification channel hết hạn sau tối đa **1 ngày** (86,400 giây) → auto-renew bằng BullMQ scheduled job.
- Header `X-Goog-Channel-Token` (custom token mà MediaOS set khi đăng ký) — validate để chống replay.
- Payload tối giản: chỉ biết có thay đổi trong folder → trigger `files.list(q=modifiedTime>lastSync)`.
- Dedup: `drive_file_id` idempotency key trong `content_assets.external_url`.

### Polling (fallback / bổ sung)

- **Hourly incremental** (`drive-hourly-sync`): BullMQ cron `30 * * * *` — kéo files modified trong 1h.
- **Daily full sync** (`drive-daily-sync`): cron `0 22 * * *` UTC — reconcile toàn bộ thư mục dự án.

---

## 5. Mapping vào model MediaOS

### `platforms`

Không có entry `google_drive` trong seed hiện tại. Cần thêm khi build:
- `platforms.code='google_drive'` **(new seed — design only)**.
- Cập nhật CHECK constraint `platforms_code_check` **(migration mới — design only)**.

### `platform_accounts`

| Drive / Google field | MediaOS column |
|--------------------|----------------|
| Google account email | `platform_accounts.account_email` |
| `refresh_token` hoặc service account key | `platform_accounts.secret_ciphertext` (envelope-encrypted) |
| Root folder ID (thư mục công ty) | `platform_accounts.account_identifier` |
| — | `platform_accounts.platform_id → platforms.id` (google_drive) |

### `content_assets`

Đây là table chính cho Drive connector:

| Drive field | MediaOS column |
|------------|----------------|
| `file_id` | **(new column — design only)** `content_assets.external_id text` — Drive file ID |
| `webViewLink` | `content_assets.external_url` |
| `name` | `content_assets.name` |
| `mimeType` → map | `content_assets.asset_type` (e.g. `application/vnd.google-apps.document` → `script`; `video/*` → `raw_video`/`edited_video`) |
| `modifiedTime` | `content_assets.updated_at` |
| `owners[0].emailAddress` | map → `content_assets.uploaded_by` (via user email lookup) |

> **Mapping `asset_type`:**
> - `application/vnd.google-apps.document` → `script`
> - `video/mp4`, `video/quicktime` → `raw_video` hoặc `edited_video` (phân biệt qua folder path)
> - `image/jpeg`, `image/png` → `thumbnail`
> - `application/pdf` → `seo_document`

### `content_items`

Không map trực tiếp — Drive files gắn với `content_item` thông qua `content_assets.content_item_id`. Quy ước naming folder: `/{project_code}/{content_item_code}/` để auto-link.

### Folder convention **(design proposal)**

```
Google Drive Root (company root folder)
└── {project_code}/          ← tương ứng projects.code
    └── {content_item_code}/ ← tương ứng content_items.code
        ├── scripts/
        ├── raw/
        ├── edited/
        └── thumbnails/
```

Connector đọc `content_items.code` và `projects.code` để build Drive path → link asset.

---

## 6. Rủi ro bảo mật / Security risks

### Token storage

`refresh_token` (OAuth) hoặc service account private key (JSON) lưu qua `SecretEncryptionService`:

```
encryptSecret(refreshTokenOrKey, { companyId, recordId: platformAccountId, purpose: 'platform_account' })
```

### Drive Push Notification security

- Set `X-Goog-Channel-Token` = HMAC(channel_id, WEBHOOK_SECRET) khi đăng ký.
- Validate token trên mỗi incoming push trước khi xử lý.
- Không tin payload notification — luôn fetch lại metadata từ Drive API để verify.

### Danh sách rủi ro

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| `refresh_token` / service account key rò | CRITICAL | Envelope-encrypt + RLS + column-grant |
| Drive folder public share leak | HIGH | Chỉ lưu `webViewLink`; không expose Drive token trong UI |
| SSRF qua Drive URL | MEDIUM | Không fetch Drive URL server-side; chỉ lưu URL string cho client |
| File deleted → broken `external_url` | MEDIUM | Daily sync check `trashed=true`; flip `content_assets.status='archived'` |
| Service account domain-wide delegation misuse | HIGH | Tối thiểu scope; không dùng domain-wide nếu không cần |
| Webhook replay | MEDIUM | Channel token validation; process idempotent (xem dedup) |
| Tenant isolation | CRITICAL | RLS FORCE; `platform_accounts.company_id` |

---

## 7. Thứ tự ưu tiên build / Build priority

**P5** — sau các connector doanh thu (YouTube, AdSense, TikTok, Facebook).

Lý do:
- Drive connector không liên quan trực tiếp đến doanh thu — là asset management workflow.
- Phụ thuộc Google OAuth infra (đã có từ YouTube connector).
- `content_assets` table đã có (G6-4 ✅) — chỉ cần thêm `external_id` column.
- Cần thiết kế folder naming convention và thông qua với team production trước khi build.
- Có thể build phần `external_url` linking (minimal) trước, rồi mở rộng auto-sync sau.

Dependencies: YouTube OAuth infra, `content_assets` (G6-4 ✅), `platforms` seed update (design only).
