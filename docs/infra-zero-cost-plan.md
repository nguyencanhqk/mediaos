# Hạ tầng $0 — Kế hoạch triển khai & Backup offsite (G0-5)

> **Mục tiêu G0-5** ([`TASKS.md:56`](../TASKS.md)): chốt hạ tầng chi phí ~0đ cho giai đoạn vận hành nội bộ + kế hoạch backup offsite chống mất dữ liệu.
> **Cụ thể hóa** [ADR-0011](adr/0011-zero-cost-infra.md) (nguyên tắc) thành quyết định triển khai đo được. Liên quan: [ADR-0003](adr/0003-pgbouncer-transaction-mode.md) (PgBouncer) · [ADR-0013](adr/0013-valkey-bullmq-socketio.md) (Valkey) · [ADR-0014](adr/0014-storage-r2-minio-s3.md) (Storage).
> **Tải tham chiếu (PRD):** ~200 nhân sự · 100 kênh · ~300 video/tháng · tải đồng thời thực tế thấp (công cụ nội bộ, giờ hành chính).
> **3 bất biến chi phối:** backup phải mã hóa (chứa secret/payroll) · audit/snapshot append-only không được mất · tenant isolation giữ nguyên khi restore.

---

## 1. Quyết định

| Hạng mục | Quyết định | Ghi chú |
| --- | --- | --- |
| **Nền tảng chính** | **Oracle Cloud Always Free — VM Ampere A1 (ARM64)** | Free *vĩnh viễn*, đủ RAM cho cả stack |
| **Phương án dự phòng** | **On-prem** (1 máy chủ/PC Linux trong văn phòng) | Khi không cấp được A1 hoặc muốn tự chủ hoàn toàn |
| **Triển khai** | Docker Compose (1 VM) — Postgres + PgBouncer + Valkey + MinIO + API + worker + reverse-proxy | Đúng stack [`CLAUDE.md` §4](../CLAUDE.md) |
| **Reverse proxy / TLS** | **Caddy** (auto HTTPS Let's Encrypt) | 0đ, cấu hình tối thiểu |
| **Backup DB offsite** | `pg_dump` nén + **mã hóa** → **Backblaze B2** (10GB free) | Lịch hằng đêm, giữ nhiều mốc |
| **Backup object (MinIO)** | `rclone sync` MinIO → B2/Drive (chỉ artifact nhỏ) | File video lớn xem §4 |
| **Health/canary** | [`ecc:canary-watch`](../TASKS.md) sau mỗi deploy + cron định kỳ | GX-5 |

> **Vì sao Ampere A1 chứ không phải 2 VM AMD Micro:** gói AMD Always Free chỉ 1GB RAM/VM — không đủ cho Postgres + Valkey + MinIO + JVM-free Node. Gói **Ampere A1 cho tới 4 OCPU + 24GB RAM** (chia 1 hoặc nhiều VM) là tài nguyên free đáng giá nhất và đủ rộng cho tải này.

---

## 2. Cấu hình VM & phân bổ tài nguyên (Oracle A1)

**Quota Always Free liên quan** (tại thời điểm chốt — phải kiểm tra lại khi tạo, free tier có thể đổi):

| Tài nguyên | Hạn mức Always Free | Dùng cho MediaOS |
| --- | --- | --- |
| Ampere A1 compute | tối đa **4 OCPU + 24 GB RAM** (tổng) | 1 VM: 4 OCPU / 24 GB |
| Block Volume | tổng **200 GB** | 50 GB boot + 150 GB data |
| Object Storage | 10 GB (Standard) + 10 GB Archive | KHÔNG đủ chứa video → xem §4 |
| Băng thông egress | 10 TB/tháng | thừa cho nội bộ |

**Phân bổ trong 1 VM (24 GB RAM) — đề xuất khởi điểm:**

| Service | RAM (mềm) | Ghi chú |
| --- | --- | --- |
| PostgreSQL 16/17 | 6–8 GB | `shared_buffers ~25%`, app role non-superuser ([ADR-0001](adr/0001-rls-multi-tenant.md)) |
| PgBouncer | <100 MB | transaction-mode ([ADR-0003](adr/0003-pgbouncer-transaction-mode.md)) |
| Valkey | 1–2 GB | cache + BullMQ + presence ([ADR-0013](adr/0013-valkey-bullmq-socketio.md)) |
| MinIO | 1–2 GB | chỉ nếu KHÔNG dùng R2 (§4) |
| API (NestJS) + worker BullMQ | 2–4 GB | tách process worker |
| Caddy | <100 MB | TLS + static (Vite build) |
| Dự phòng OS/đệm | phần còn lại | tránh OOM |

> Đây là cấu hình **đơn nút (single-node)** — chấp nhận được cho vận hành nội bộ. Không HA. Đánh đổi này được bù bằng backup offsite chặt (§3) + RTO/RPO rõ ràng.

---

## 3. Backup offsite — chiến lược 3-2-1

**3 bản sao · 2 loại lưu trữ · 1 offsite.** Dữ liệu sống còn = **Postgres** (chứa audit, payslip-snapshot, finance-snapshot, secret đã mã hóa).

### 3.1. Lịch & nội dung

| Thành phần | Cách | Tần suất | Nơi |
| --- | --- | --- | --- |
| **Postgres full** | `pg_dump -Fc` (custom format) → `gzip` → **mã hóa GPG/age** | **Hằng đêm 02:00 (Asia/Ho_Chi_Minh)** | local `/backup` + đẩy **B2** |
| **Postgres WAL/PITR** *(tùy chọn nâng cao)* | `pg_basebackup` + archive WAL | tuần + liên tục | B2 — bật khi rủi ro tăng |
| **MinIO artifact** (file/link nộp việc nhỏ) | `rclone sync` | hằng ngày | B2/Drive |
| **Khóa mã hóa / .env / KMS material** | export **thủ công, kênh riêng** (KHÔNG cùng chỗ DB dump) | khi đổi | két offline / password manager |

### 3.2. Mã hóa (bắt buộc — bất biến #3)

- DB dump chứa secret (đã envelope-encrypt) + dữ liệu PII/payroll → **dump phải mã hóa at-rest** trước khi rời máy chủ. Dùng `age`/GPG với khóa **không** lưu cùng chỗ backup.
- **Tách khóa khỏi dữ liệu:** nếu B2 lộ, dump vẫn không giải mã được. Đây là điều kiện để dùng cloud free an toàn.

### 3.3. Retention (giữ mốc)

`7 daily · 4 weekly · 6 monthly` (GFS). Dump nén của DB nội bộ tải này thường nhỏ → vừa 10 GB free B2; theo dõi và cảnh báo khi gần hạn.

### 3.4. RPO / RTO mục tiêu (giai đoạn nội bộ)

| Chỉ số | Mục tiêu | Cơ sở |
| --- | --- | --- |
| **RPO** (mất tối đa) | ≤ 24h (chỉ daily dump) → ≤ 5 phút nếu bật PITR/WAL | daily đủ cho nội bộ; bật WAL khi cần |
| **RTO** (khôi phục) | ≤ 2–4h | dựng VM mới + restore dump + smoke test |

### 3.5. Restore drill (BẮT BUỘC — backup chưa test = chưa có backup)

- **Quý/lần:** kéo dump mới nhất từ B2 → restore vào VM/throwaway DB → chạy **test 2-tenant isolation** (G2-5) + smoke API → xác nhận audit/snapshot còn nguyên, không lẫn tenant.
- Ghi nhật ký mỗi lần drill (ngày, dump nào, thời gian restore, pass/fail).

---

## 4. Vấn đề dung lượng video lớn (rủi ro #1 — phải chốt)

Free tier object storage (Oracle 10 GB / R2 10 GB / B2 10 GB) **KHÔNG đủ** nếu lưu file video gốc (300 video/tháng, mỗi video hàng trăm MB–vài GB).

**Quyết định MVP-0:** Bước nộp việc lưu **LINK** (Google Drive / YouTube unlisted / link nội bộ), **không** upload file video gốc vào storage hệ thống. Storage hệ thống chỉ giữ **artifact nhỏ** (ảnh thumbnail, tài liệu, kịch bản) → vừa free tier.

**Đường nâng cấp (khi vượt free):** Cloudflare R2 trả phí (không tính egress — rẻ cho media, [ADR-0014](adr/0014-storage-r2-minio-s3.md)) hoặc mở rộng block volume on-prem. Quyết định này **không** thay đổi code (vẫn S3 SDK).

---

## 5. Health check & quan trắc (0đ)

- **Sau deploy:** [`ecc:canary-watch`](../TASKS.md) kiểm `/health` API + static + DB ping.
- **Định kỳ:** cron gọi health endpoint; uptime monitor free (vd UptimeRobot) báo khi VM chết.
- **Backup alerting:** job backup thất bại / không đẩy được B2 → cảnh báo (email/Slack) — gắn vào lỗ hổng "alerting runtime" GX/G2-4.

---

## 6. Giới hạn free-tier cần theo dõi + ngưỡng nâng cấp

| Tín hiệu | Ngưỡng cảnh báo | Hành động |
| --- | --- | --- |
| RAM VM | > 80% kéo dài | tách service / nâng cấp paid |
| Block volume 200 GB | > 75% | dọn dump cũ / mở rộng |
| B2 10 GB free | > 8 GB | siết retention / lên paid B2 (rẻ) |
| Oracle "reclaim idle Always Free" | cảnh báo từ Oracle | giữ VM hoạt động / chuyển paid nhỏ |
| Tải đồng thời tăng (thêm team/SaaS) | p95 latency xấu | lên kế hoạch multi-node / managed |

---

## 7. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- |
| **Single-node, không HA** | Cao | Backup offsite chặt + RTO ≤4h + IaC/Compose để dựng lại nhanh |
| **Oracle thu hồi tài nguyên Always Free idle** | TB | Giữ tải hoạt động; sẵn phương án on-prem; dump offsite nên dù mất VM vẫn khôi phục |
| **Khó provision A1 ở một số region** | TB | Thử nhiều AD/region; fallback on-prem ngay |
| **ARM64** | Thấp | Toàn stack (Postgres/Valkey/MinIO/Node/Caddy) có image arm64 chính thức |
| **Dung lượng video** | Cao | §4 — lưu link, không lưu file gốc; nâng cấp R2 khi cần |
| **Backup lộ chứa secret/PII** | Cao | Mã hóa dump + tách khóa khỏi dữ liệu (§3.2) |
| **Mất khóa mã hóa = mất luôn backup** | Cao | Lưu khóa ở ≥2 nơi an toàn ngoài máy chủ (két/password manager); ghi quy trình break-glass |

---

## 8. Definition of Done cho G0-5

- [x] Chốt nền tảng chính (Oracle A1) + phương án dự phòng (on-prem).
- [x] Sizing VM + phân bổ tài nguyên cho cả stack.
- [x] Kế hoạch backup offsite 3-2-1: nội dung, lịch, mã hóa, retention, RPO/RTO.
- [x] Quy trình restore drill định kỳ.
- [x] Chốt cách xử lý video lớn (lưu link ở MVP-0) + đường nâng cấp.
- [x] Danh sách giới hạn free-tier + ngưỡng nâng cấp.
- [ ] **Thực thi ở G1-8** (script `pg_dump`→B2) + **G1-2** (Docker Compose) — đây mới là lúc dựng thật; G0-5 chỉ chốt quyết định.

---

## 9. Câu hỏi mở cần xác nhận

1. **Oracle A1 vs on-prem ngay từ đầu?** Có sẵn máy chủ văn phòng chạy 24/7 không? Nếu có, on-prem cho RTO tốt hơn (data tại chỗ) — vẫn cần offsite dump.
2. **Region Oracle** (Singapore gần VN nhất) — có cấp được A1 không? Cần thử sớm vì hay hết slot.
3. **Lưu link video** có chấp nhận được về nghiệp vụ không, hay bắt buộc giữ file gốc trong hệ thống (→ phải tính chi phí R2/đĩa ngay)?
4. **Bật PITR/WAL** ngay hay để daily dump là đủ cho giai đoạn nội bộ? (Ảnh hưởng RPO: 24h → ~phút.)
5. **Nơi giữ khóa mã hóa backup** + ai giữ (break-glass) — cần chốt trước khi có dữ liệu thật.
6. **Backup B2 vs Google Drive** — chọn một làm chính (đề xuất **B2**: S3-compatible, hợp `rclone`/SDK, 10GB free).

---

_Liên quan: [ADR-0011](adr/0011-zero-cost-infra.md) · [ADR-0014](adr/0014-storage-r2-minio-s3.md) · [`TASKS.md`](../TASKS.md) G1-2/G1-8/GX-5 · [`CLAUDE.md`](../CLAUDE.md) §2 (3 bất biến)._
