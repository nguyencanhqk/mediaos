# RELEASE-09 — MONITORING · LOGGING · ALERTING · SUPPORT READINESS (WS9)

> Work Order **`S6-REL-1`** · nguồn: [IMPLEMENTATION-09](../IMPLEMENTATION/IMPLEMENTATION-09_Sprint_6_Stabilization_Release_Candidate_Go-live_Execution_Plan.md) §18 · thiết kế: [DEVOPS-09](../DEVOPS/DEVOPS-09_Monitoring_Logging_Alerting.md)
> Chốt: **2026-07-30** · `master` `c4afe351`
>
> **Quy tắc:** ô nào KHÔNG đo được thì ghi **KHÔNG ĐO ĐƯỢC**, không tick cho đủ bảng. Một hệ giám sát
> báo xanh vì nó không có nguồn dữ liệu là chế độ hỏng nguy hiểm nhất — người trực tin rằng không có sự
> cố trong khi thật ra là không có tín hiệu. Nguyên tắc này được **ép bằng code**:
> `scripts/lib/ops-alert-rules.mjs` xếp `unknown` NẶNG HƠN `ok` và trả exit ≠ 0.

---

## 1. Đóng KI-011 — trước và sau

`RELEASE-02` KI-011 (`S2`, **chặn go-live**): *"Chưa có cảnh báo tự động (5xx-rate, disk, backup-fail, SSL)"*.
`RELEASE-01` §8 ghi ❌ cho cả "log có cấu trúc" lẫn "cảnh báo tự động".

| | Trước WO này | Sau WO này |
| --- | --- | --- |
| Alert rule §18.3 | 9 dòng trong tài liệu, 0 dòng chạy được | **8 nhóm ĐO THẬT** qua `scripts/ops-alert-check.mjs` |
| Logic quyết định | — | `scripts/lib/ops-alert-rules.mjs` — **44 test** (`node --test`) |
| Test có được chạy không | — | CÓ: step `tooling-tests` trong `harness/check.sh` + job trong `.github/workflows/api.yml` |
| Thiếu dữ liệu | — | `unknown` ⇒ exit 1 (KHÔNG gộp vào xanh) |

---

## 2. Monitoring checklist (IMPL-09 §18.2)

| Nhóm | Có gì hôm nay | Đo bằng |
| --- | --- | --- |
| Availability | ✅ liveness + readiness tách bạch | `/health` · `/health/db` · `canary-watch.sh` · `ops-alert-check` |
| **Định danh bản đang chạy** | ✅ **MỚI (S6-REL-1)** — version · commit · builtAt · migrationHead | `/health` → `data.build` |
| Database | ✅ readiness + latency + **lệch migration** | `ops-alert-check` |
| API latency P95/P99 theo endpoint | ⚠️ **chỉ baseline thủ công**, không liên tục | `scripts/perf-smoke.mjs` |
| Error rate 4xx/5xx theo module | ❌ **KHÔNG ĐO ĐƯỢC** — không có metric store; chỉ đếm được dòng lỗi trong `logs/api.err.log` | `ops-alert-check` (thô) |
| Auth (login fail, khoá tài khoản) | ⚠️ có **dữ liệu** (`login_logs`, `user_security_events`) nhưng **chưa có cảnh báo ngưỡng** | màn `/system/login-logs` |
| Attendance · Leave · Task · Notification · Dashboard · File (lỗi theo module) | ❌ **KHÔNG ĐO ĐƯỢC** — cần APM/metric store, ngoài phạm vi MVP | — |
| Job nền | ✅ đếm `Failed` theo cửa sổ | `ops-alert-check` · `/system/jobs` |
| Audit write failure | ⚠️ gián tiếp qua job Failed + dòng lỗi log | — |

> 4 dòng ❌/⚠️ ở trên là **phạm vi bị thu hẹp có chủ đích**: khai một rule rồi để nó luôn xanh vì không
> có nguồn dữ liệu còn tệ hơn không khai — nó tạo cảm giác được canh gác. Đưa vào post-MVP backlog.

---

## 3. Alert rule ĐANG CHẠY (IMPL-09 §18.3)

`node scripts/ops-alert-check.mjs` — mức: `ok` · `warn` · `crit` · `unknown`; exit `0` / `1` (warn hoặc
unknown) / `2` (crit).

| # | Alert §18.3 | Nguồn đo | warn | crit | Chủ |
| --- | --- | --- | --- | --- | --- |
| 1 | Backend down | `/health` liveness | — | không OK | DevOps |
| 2 | DB connection | `/health/db` **body** (fail-soft: luôn HTTP 200 ⇒ phải đọc body) | latency > 500ms | `status=down` | DevOps/BE |
| 3 | *(thêm)* Lệch migration | journal ↔ `drizzle.__drizzle_migrations` | ≥ 1 tồn đọng | — | BE Lead |
| 4 | Notification/job failure | `system_job_runs` status `Failed` trong cửa sổ | ≥ 1 | ≥ 10 | BE/DevOps |
| 5 | API 5xx spike | đếm `ERROR` ở 2MB cuối `logs/api.err.log` | ≥ 20 | ≥ 200 | BE Lead |
| 6 | Disk | dung lượng trống ổ chứa repo/pgdata | ≤ 10 GB | ≤ 2 GB | DevOps |
| 7 | Backup fail | tuổi bản backup mới nhất | > 26h | > 50h | DevOps |
| 8 | SSL expiry | hạn cert của domain API | ≤ 14 ngày | ≤ 3 ngày | DevOps |

**Chưa nhận (nói rõ để không ai tưởng đã có):** *Login fail spike* · *Permission denied (403) spike* ·
*Slow query* — cần tổng hợp theo chuỗi thời gian mà dự án chưa có hạ tầng. Ghi vào post-MVP.

Rule #3 và #5 không nằm trong §18.3 gốc — thêm vì **sự cố PROD ĐÃ xảy ra**: 2026-07-24 thiếu mig `0511`
⇒ job nền Failed mỗi nhịp, `api.err.log` phình **149 MB**, không có cảnh báo nào nổ.

### Kết quả chạy thật — 2026-07-30 trên PROD

```text
OPS ALERT CHECK (IMPL-09 §18.3) — http://localhost:3100/api/v1 · cửa sổ 60 phút

  ✓ ok      Backend down                       /health 200 status=ok
  ✓ ok      DB connection/readiness            latency 7ms
  ✓ ok      Lệch migration (schema ↔ journal)  schema ở head
  ✓ ok      Job nền thất bại                   0 lần chạy Failed trong cửa sổ
  ✓ ok      Lỗi ứng dụng trong log             0 dòng lỗi trong cửa sổ
  ✓ ok      Dung lượng trống                   còn 393.2 GB
  ? unknown Tuổi bản backup mới nhất           KHÔNG ĐO ĐƯỢC (không thấy thư mục/bản backup nào)
  ✓ ok      Hạn chứng chỉ TLS                  còn 48 ngày

  Tổng thể: UNKNOWN   (exit 1)
```

> 🔴 **Phát hiện ngay lần chạy đầu tiên — KI-050:** không có thư mục `backups/`, không có scheduled task
> nào chạy `scripts/backup-db.sh`. Tức **chưa từng có một bản backup nào được tạo trên máy PROD**.
> `scripts/backup-db.sh` tồn tại từ G1-8 và `S6-PERF-DB-1` đã chứng minh restore-drill chạy được — nhưng
> drill đó tự `pg_dump` tại chỗ, nó KHÔNG chứng minh có backup định kỳ. Đúng lại bài học của chính dự
> án: *script tồn tại ≠ script chạy được*. Xem `RELEASE-02` KI-050 — **chặn go-live**.

---

## 4. Đặt lịch chạy (owner — cần làm trước go-live)

Cảnh báo chỉ có giá trị khi nó tự chạy. Đăng ký Windows Task Scheduler mỗi 10 phút:

```powershell
# Chạy trong PowerShell Administrator, tại gốc repo
$repo = "C:\dev 2\MediaOS"
$action  = New-ScheduledTaskAction -Execute "node.exe" `
  -Argument "scripts\ops-alert-check.mjs --quiet" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "MediaOS-OpsAlert" -Action $action -Trigger $trigger `
  -Description "S6-REL-1 · IMPL-09 §18.3 — cảnh báo vận hành MediaOS" -RunLevel Highest

# Backup hằng ngày 02:00 (đóng KI-050)
$bAction  = New-ScheduledTaskAction -Execute "C:\Program Files\Git\bin\bash.exe" `
  -Argument "scripts/backup-db.sh" -WorkingDirectory $repo
$bTrigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName "MediaOS-BackupDaily" -Action $bAction -Trigger $bTrigger `
  -Description "S6-REL-1 · backup DB PROD hằng ngày" -RunLevel Highest
```

`--quiet` chỉ in khi có `warn`/`crit`/`unknown`. Mọi lần khác `ok` đều im lặng; mỗi lần không-ok ghi
một dòng JSON vào `logs/ops-alerts.log`. Muốn đẩy ra kênh chat: đặt `OPS_ALERT_WEBHOOK` (URL nằm trong
env của máy, **không commit**).

**Kiểm tra lịch đã chạy chưa:** `Get-ScheduledTask -TaskName MediaOS-*` + xem `logs/ops-alerts.log`.

---

## 5. Logging checklist (IMPL-09 §18.4)

| Mục | Trạng thái | Bằng chứng / ghi chú |
| --- | --- | --- |
| Mỗi request có request id | ✅ | `meta.request_id` ở MỌI response (kiểm bởi `release-smoke` SMOKE-010) |
| Error log có module/endpoint/user id an toàn/company id | ⚠️ một phần | `AllExceptionsFilter` ghi method+path+mã lỗi+`req=<request_id>`; **chưa** ghi company/user |
| Không log password/token/secret | ✅ | chốt hồi quy `scripts/check-no-secret-literals.mjs` (chạy trong `check.sh` + CI) |
| Audit log ≠ system log | ✅ | `audit_logs` append-only (BẤT BIẾN #2), tách khỏi log ứng dụng |
| Notification event có event id/dedupe key | ✅ | `dedupeKey` bắt buộc ở kênh máy LMS→NOTI |
| Background job có id/status/duration/error | ✅ | `system_job_runs` + `/system/jobs` |
| Migration/deployment log được lưu | ✅ | `drizzle.__drizzle_migrations` · `logs/api.*.log` · **MỚI**: định danh build ở `/health` |
| Export/file access log | ✅ | `file_access_logs` (append-only) |
| **Log có cấu trúc JSON** | ❌ **CHƯA** | Nest `Logger` dạng text — **KI-009** (`S3`, không chặn go-live) |

---

## 6. Support readiness (IMPL-09 §18.5) & hypercare (§18.6)

> ⚠️ **Ranh giới:** bộ **guide nội dung** (user · manager · HR · admin · FAQ) thuộc `S6-GOLIVE-1`
> (WS10 §19.5 handoff package). Phần dưới là **QUY TRÌNH** — cái phải sẵn TRƯỚC khi bấm go-live.

### 6.1 Kênh tiếp nhận & escalation

| Mục | Chốt |
| --- | --- |
| Kênh báo lỗi | Kênh nội bộ công ty (owner công bố ở thông báo T-0 — `RELEASE-08` §7) |
| Người trực | **Owner** (dự án 1 người + agent) |
| P0/S0 (không đăng nhập được · lộ dữ liệu · mất dữ liệu) | Báo owner NGAY · phản hồi trong **1 giờ** · cân nhắc rollback (`RELEASE-08` §5.1) |
| P1/S1 (một module chính hỏng, có workaround) | Phản hồi trong **4 giờ** làm việc · hotfix hoặc ghi known issue |
| P2/S2 trở xuống | Ghi vào `RELEASE-02`, xử lý theo backlog |

### 6.2 Mẫu báo lỗi (dán vào kênh)

```text
[LỖI] <một dòng mô tả>
Người báo:            <tên · vai trò>
Thời điểm:            <ngày giờ>
Màn hình / thao tác:  <đang ở đâu, bấm gì>
Kết quả thấy:         <thông báo lỗi nguyên văn>
Kết quả mong đợi:     <đáng lẽ phải ra gì>
Ảnh chụp:             <đính kèm>
request_id:           <nếu màn hình có hiện>
Có lặp lại không:     <có/không>
```

`request_id` là khoá truy vết end-to-end — mọi response đều mang. Có nó thì lần được đúng dòng log.

### 6.3 Hypercare (§18.6)

| Giai đoạn | Mục tiêu | Hoạt động |
| --- | --- | --- |
| T+0 → T+1 | Giám sát sát | `ops-alert-check` mỗi 10 phút (đã lên lịch) · `release-smoke` 2 lần/ngày · xử lý S0/S1 ngay |
| T+2 → T+3 | Ổn định | Triage phản hồi, hotfix nhỏ theo `RELEASE-05` §4 |
| T+4 → T+7 | Chuyển giao | Tổng hợp issue vào `RELEASE-02`, viết post-go-live report (`S6-GOLIVE-1`) |

**Điều kiện thoát hypercare:** 0 S0/S1 mở · `ops-alert-check` không `crit` trong 48h liên tục ·
`release-smoke` PASS ở 3 lần chạy liên tiếp.

---

## 7. Trạng thái §18 sau WO này

| Mục §18 | Trước | Sau |
| --- | --- | --- |
| §18.2 Monitoring checklist | một phần | ✅ có đo + ghi rõ 4 nhóm KHÔNG ĐO ĐƯỢC |
| §18.3 Alert rule | ❌ 0 rule chạy | ✅ 8 nhóm chạy được, 44 test, đã gắn cổng |
| §18.4 Logging | 8/9 | 8/9 (JSON log = KI-009, `S3`) |
| §18.5 Support readiness | ❌ | ✅ quy trình xong; **guide nội dung → `S6-GOLIVE-1`** |
| §18.6 Hypercare | ❌ | ✅ có kế hoạch + điều kiện thoát |
