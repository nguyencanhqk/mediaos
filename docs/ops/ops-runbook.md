# Ops Runbook — Canary, Backup Schedule, Harness Audit (GX-5)

> Một nguồn sự thật cho **"cái gì chạy, khi nào, ai chốt"** ở tầng vận hành MediaOS.
> Đóng GX-5 (`TASKS.md §GX`): backup offsite + health check (`ecc:canary-watch`) + `ecc:harness-audit` cuối G2/G5/G7.
> Không đụng schema, không đụng logic nghiệp vụ — chỉ scripts + lịch + runbook.

Liên quan: [`backup-restore-drill.md`](backup-restore-drill.md) (chứng minh restore) · [`../infra-zero-cost-plan.md`](../infra-zero-cost-plan.md) (chiến lược 3-2-1) · [`../AUTOMATION-PLAYBOOK.md`](../AUTOMATION-PLAYBOOK.md) §8 (kích hoạt dần).

---

## 1. Bảng lịch vận hành (cron — giờ UTC; ghi chú giờ VN)

| Việc                        | Script / lệnh                              | Tần suất                                     | Cron (UTC)                  | Giờ VN       | Ai chốt             |
| --------------------------- | ------------------------------------------ | -------------------------------------------- | --------------------------- | ------------ | ------------------- |
| **Backup DB offsite**       | `bash scripts/backup-db.sh`                | hằng ngày                                    | `0 19 * * *`                | 02:00        | tự động (cron)      |
| **Restore drill**           | `bash scripts/backup-restore-drill.sh`     | hằng tháng + sau mỗi migration đổi shape/RLS | `0 2 1 * *`                 | 09:00 ngày 1 | người đọc kết quả   |
| **Canary post-deploy**      | `bash scripts/canary-watch.sh`             | mỗi lần deploy/merge                         | (chạy trong CD, không cron) | —            | gate deploy         |
| **Canary định kỳ (uptime)** | `bash scripts/canary-watch.sh --once`      | mỗi 5 phút (tuỳ chọn)                        | `*/5 * * * *`               | —            | tự động + cảnh báo  |
| **Harness audit**           | `node <ecc>/scripts/harness-audit.js repo` | cuối G2 / G5 / G7                            | thủ công theo mốc           | —            | người đọc scorecard |

> RPO ≤ 24h, RTO ≤ 30 phút — căn cứ & cách siết (WAL/PITR) ở [`backup-restore-drill.md`](backup-restore-drill.md) §2.

---

## 2. Canary post-deploy (`scripts/canary-watch.sh`)

Kiểm chứng app vừa deploy **sống + dùng được**, KHÔNG chỉ "tiến trình lên". Hai cổng (đã có sẵn ở
`apps/api/src/health/health.controller.ts`):

| Cổng      | Đường                   | Ý nghĩa                | Kỳ vọng                                    |
| --------- | ----------------------- | ---------------------- | ------------------------------------------ |
| Liveness  | `GET /api/v1/health`    | không chạm DB          | `200` + `{"status":"ok"}`                  |
| Readiness | `GET /api/v1/health/db` | ping DB, **fail-soft** | `200` luôn; body `{"status":"ok"\|"down"}` |

**Vì sao đọc body, không chỉ mã HTTP:** readiness fail-soft trả `200` cả khi DB rớt (để LB không
giết pod vì 1 nhịp DB chậm). Nếu canary chỉ nhìn mã HTTP sẽ **xanh giả** khi DB chết. Script đọc
trường `status` (jq nếu có, fallback grep — không bắt buộc jq) và mặc định coi `down` là ĐỎ.

### Dùng

```bash
# Mặc định: localhost:3100, retry 12×5s (warmup ~60s), readiness bắt buộc DB ok.
bash scripts/canary-watch.sh

# Staging/prod: trỏ base URL kèm prefix.
CANARY_BASE_URL=https://api.funtimemediacorp.com/api/v1 bash scripts/canary-watch.sh

# Smoke nhanh 1 lượt, chỉ liveness (vd môi trường chưa gắn DB):
bash scripts/canary-watch.sh --once --no-db

# Trong pipeline CD (chặn cutover nếu đỏ):
CANARY_BASE_URL=$DEPLOY_URL/api/v1 bash scripts/canary-watch.sh || { echo "CANARY ĐỎ — rollback"; exit 1; }
```

### Cấu hình (env hoặc cờ)

| Biến                | Mặc định                       | Ý nghĩa                                              |
| ------------------- | ------------------------------ | ---------------------------------------------------- |
| `CANARY_BASE_URL`   | `http://localhost:3100/api/v1` | gốc API kèm prefix                                   |
| `CANARY_TIMEOUT`    | `5`                            | timeout mỗi request (giây)                           |
| `CANARY_RETRIES`    | `12`                           | số lần thử liveness trong cửa sổ warmup              |
| `CANARY_INTERVAL`   | `5`                            | giây giữa các lần thử (warmup ≈ retries×interval)    |
| `CANARY_REQUIRE_DB` | `1`                            | `down` ⇒ FAIL; đặt `0` để chỉ cảnh báo (liveness đủ) |

### Exit code (cho CI/cron)

| Code | Nghĩa                                                               |
| ---- | ------------------------------------------------------------------- |
| `0`  | HEALTHY — liveness sống + readiness ok (hoặc `--no-db`)             |
| `1`  | liveness fail — app không sống sau hết retry (deploy đỏ)            |
| `2`  | readiness/DB down (khi `REQUIRE_DB=1`) hoặc readiness không trả 200 |
| `3`  | lỗi cấu hình / thiếu `curl`                                         |

> Đây là canary **tầng API** (curl endpoint). Canary **tầng FE/URL** (console error, LCP, asset, SSE)
> dùng skill `ecc:canary-watch` trực tiếp trên URL web — bổ trợ, không thay thế.

---

## 3. Backup offsite (`scripts/backup-db.sh`) — đã có từ G1-8

`pg_dump -Fc` → mã hoá at-rest (age/gpg) **trước khi rời máy** (BẤT BIẾN #3: dump chứa secret đã
envelope-encrypt + PII/payroll) → `rclone` đẩy offsite → retention GFS daily. Cấu hình qua `.env`
(`BACKUP_*`, xem `.env.example`).

### Bật cron (ví dụ crontab Linux)

```cron
# /etc/cron.d/mediaos-backup — 02:00 Asia/Ho_Chi_Minh = 19:00 UTC
0 19 * * *  mediaos  cd /srv/mediaos && /usr/bin/env bash scripts/backup-db.sh >> /var/log/mediaos-backup.log 2>&1
```

- Khoá mã hoá (`BACKUP_GPG_RECIPIENT`) **không** lưu cùng chỗ dump (tách khoá khỏi dữ liệu).
- Không đặt `BACKUP_GPG_RECIPIENT` ⇒ script CẢNH BÁO và chỉ chấp nhận cho test local (không đẩy
  bản chưa mã hoá ra ngoài).
- Thất bại backup là sự cố P2 — gắn alert vào log (`grep ERROR`) hoặc exit-code của cron.

### Backup không restore-test = không phải backup

Lịch **restore drill** hằng tháng (`backup-restore-drill.sh`) chứng minh dump KHÔI PHỤC ĐƯỢC:
dump → restore vào DB tạm → verify chuỗi migration + schema + RLS/FORCE/policy + index → smoke →
tự DROP. Quy trình & checklist sign-off: [`backup-restore-drill.md`](backup-restore-drill.md).

---

## 4. Harness audit (`ecc:harness-audit`) — cuối G2 / G5 / G7

Rà cấu hình harness (tool/context/quality-gate/memory/eval/security/cost) → scorecard tất định,
tái lập được cho cùng commit. Chạy:

```bash
node "<ECC>/scripts/harness-audit.js" repo --format text --root .
# JSON cho tự động hoá:
node "<ECC>/scripts/harness-audit.js" repo --format json --root .
```

Ghi báo cáo mỗi lượt vào `docs/ops/harness-audit-<YYYY-MM-DD>.md`. Lượt mới nhất (mốc G16/GX):
[`harness-audit-2026-06-16.md`](harness-audit-2026-06-16.md) — **25/29 (consumer)**; 2 gap đã ghi
(eval fixtures, `SECURITY.md`) làm backlog, KHÔNG chặn GX-5.

---

## 5. Việc KHÔNG làm trong runbook này (giới hạn trung thực)

- **Không** tự sửa `~/.claude/settings.json` toàn cục để cài cron/hook — cron là việc người vận hành
  cài trên máy chủ, không phải thay đổi trong repo app.
- **Không** đụng schema / logic nghiệp vụ (GX-5 là 🟢 ops). Nếu phát hiện việc cần migration → tách lane.
- WAL archiving / PITR (siết RPO xuống phút) là **nâng cao** — xem `infra-zero-cost-plan.md §3.1`, chưa bật.
