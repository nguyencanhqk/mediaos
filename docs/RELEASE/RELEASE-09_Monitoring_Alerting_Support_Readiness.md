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
| Alert rule §18.3 | 9 dòng trong tài liệu, 0 dòng chạy được | **8 nhóm ĐO THẬT** qua `scripts/ops-alert-check.mjs` — **→ 11 nhóm từ 2026-08-12** (thêm #9–#11, xem §3) |
| Logic quyết định | — | `scripts/lib/ops-alert-rules.mjs` — **44 test** (`node --test`) — **→ 63 test từ 2026-08-12** |
| Test có được chạy không | — | CÓ: step `tooling-tests` trong `harness/check.sh` + job trong `.github/workflows/api.yml` |
| Thiếu dữ liệu | — | `unknown` ⇒ exit 1 (KHÔNG gộp vào xanh) |

---

## 2. Monitoring checklist (IMPL-09 §18.2)

| Nhóm | Có gì hôm nay | Đo bằng |
| --- | --- | --- |
| Availability | ✅ liveness + readiness tách bạch | `/health` · `/health/db` · `canary-watch.sh` · `ops-alert-check` |
| **Mặt PROD ngoài API** (fbpost :3500 · LMS :3400) | ✅ **MỚI (2026-08-12)** — dò trang công khai thật + soi bản build Next | `ops-alert-check` rule #9–#11 |
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
| 5 | API 5xx spike | dòng `ERROR` có **timestamp nằm trong cửa sổ**, đọc 8MB cuối `logs/api.err.log` | ≥ 20 | ≥ 200 | BE Lead |
| 6 | Disk | dung lượng trống ổ chứa repo/pgdata | ≤ 10 GB | ≤ 2 GB | DevOps |
| 7 | Backup fail | tuổi bản backup mới nhất | > 26h | > 50h | DevOps |
| 8 | SSL expiry | hạn cert của domain API | ≤ 14 ngày | ≤ 3 ngày | DevOps |
| 9 | *(thêm)* fbpost đăng bài :3500 | GET `http://localhost:3500/login` — **không đi theo redirect** | 3xx/4xx · 200 mất dấu nhận dạng | ≥ 500 · không ai trả lời | DevOps |
| 10 | *(thêm)* LMS đào tạo :3400 | GET `http://localhost:3400/login` — như trên, **trừ** 3xx có `Location` kết thúc `/lms` = **ok** (LMS đăng nhập qua SSO từ 21/09, `S19-OPS-PRODDBBOOT-1`) | như trên; 3xx đi chỗ khác vẫn warn | như trên | DevOps |
| 11 | *(thêm)* Bản build Next đang phục vụ | `.next/static/development\|webpack` + đếm `eval(` trong bundle middleware (đường dẫn lấy từ `middleware-manifest.json`) | — | có bundle DEV | DevOps |

**Chưa nhận (nói rõ để không ai tưởng đã có):** *Login fail spike* · *Permission denied (403) spike* ·
*Slow query* — cần tổng hợp theo chuỗi thời gian mà dự án chưa có hạ tầng. Ghi vào post-MVP.

Rule #3 và #5 không nằm trong §18.3 gốc — thêm vì **sự cố PROD ĐÃ xảy ra**: 2026-07-24 thiếu mig `0511`
⇒ job nền Failed mỗi nhịp, `api.err.log` phình **149 MB**, không có cảnh báo nào nổ.

> ⚠️ **Rule #5 đọc TIMESTAMP TỪNG DÒNG, không dùng `mtime` của file** (`S6-OPS-LOGWINDOW-1`). Bản đầu
> gate bằng `mtime` rồi đếm mọi chữ `ERROR` trong 2MB cuối — hỏng **cả hai chiều**: ngày 2026-08-01 nó
> trả **1787 "lỗi trong 60 phút"** trong khi dòng lỗi mới nhất là của **30/07** (CRIT giả nổ mỗi 10
> phút); và ở chiều ngược lại, một lỗi ghi ở phút 59 rồi im 61 phút sẽ bị báo **XANH**. Logic + lý do
> đầy đủ: `scripts/lib/ops-log-window.mjs`, spec `scripts/lib/ops-log-window.test.mjs`.

### Rule #9–#11 — mở phạm vi ra ngoài API (2026-08-12)

Rule #9–#11 cũng sinh ra từ **sự cố PROD ĐÃ xảy ra**, ngày 11–12/08: `next dev` chạy trong
`apps/fbpost` ghi đè chính `.next` mà NSSM `MediaOS-Social` (`next start`) đang phục vụ ⇒ bundle
`devtool:'eval'` ⇒ edge runtime **cấm sinh mã từ chuỗi** ⇒ `EvalError` ở middleware ⇒ **500 MỌI đường
dẫn suốt ~15 tiếng**, qua cả `localhost:3500` lẫn domain.

Không một chỉ báo nào bắt được. `Get-Service` = `Running`; `social.out.log` in `▲ Next.js 15.5.22` +
`✓ Ready in 717ms` mỗi lần boot; và `ops-alert-check` **chỉ dò API :3100** nên 8/8 nhóm vẫn xanh/warn.
Bài học: **một dịch vụ không nằm trong danh sách đo là một dịch vụ không có ai canh** — `Running` +
`Ready` không chứng minh gì, chỉ HÀNH VI HTTP mới chứng minh.

Vì vậy #9/#10 đo **hiện tượng** (trang có sống không) còn #11 đo **nguyên nhân** (bản build có phải
dev không) — #11 bắt được TRƯỚC khi nó thành 500 và chỉ thẳng thủ phạm thay vì "trang chết, không rõ
vì sao". #9/#10 cố tình **không đi theo redirect**: để `fetch` tự follow thì một trang công khai bị
cổng phiên đá về `/login` vẫn hiện ra "200 ok" — đúng chế độ hỏng đã cắn ngày 12/08 với hai trang
chính sách Meta.

> 🔴 **Thêm một mặt PROD mới (app/cổng/dịch vụ) ⇒ PHẢI thêm vào `DEFAULT_SITES` trong
> `scripts/lib/ops-alert-rules.mjs`** (chuyển từ `ops-alert-check.mjs` ở `S19-OPS-PRODDBBOOT-1` để có
> test), nếu không nó sẽ sập âm y hệt. Danh sách trang dò RỖNG ⇒ `unknown`, không bao giờ ra xanh.
> Ghi đè tại chỗ khi cần: `OPS_SITES` (JSON) · `OPS_SITE_TIMEOUT_MS`.
>
> **Chuyển hướng đúng chỗ là sống — `expectRedirect`.** Mỗi trang có thể khai `expectRedirect` (vd
> `"/lms"`): phản hồi 3xx mà ĐƯỜNG DẪN của `Location` kết thúc bằng giá trị đó (có/không `/` cuối) ⇒
> `ok`. So phần cuối đường dẫn, **không ghim miền**, không xét query. Mọi ca khác giữ mức cũ: 3xx đi
> chỗ khác hoặc thiếu `Location` = warn · 2xx sai dấu nhận dạng = warn · 4xx = warn · 5xx = crit ·
> không ai trả lời = crit · lỗi lạ = unknown. Trang KHÔNG khai trường này ⇒ mọi 3xx vẫn warn (fbpost).
> `OPS_SITES` nhận trường này; `expectRedirect` sai kiểu hoặc chỉ `/` ⇒ cả cấu hình bị coi là hỏng ⇒
> `unknown`. Đo 16/10/2026 trên máy PROD: SITE_LMS = `ok` (`HTTP 307 → …/lms`) — hết warn oan từ 21/09.

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

### Kết quả chạy thật — 2026-08-01 trên PROD (sau `S6-OPS-LOGWINDOW-1`)

```text
OPS ALERT CHECK (IMPL-09 §18.3) — http://localhost:3100/api/v1 · cửa sổ 60 phút

  ✓ ok      Backend down                       /health 200 status=ok
  ✓ ok      DB connection/readiness            latency 8ms
  ✓ ok      Lệch migration (schema ↔ journal)  schema ở head
  ✓ ok      Job nền thất bại                   0 lần chạy Failed trong cửa sổ
  ✓ ok      Lỗi ứng dụng trong log             0 dòng lỗi trong cửa sổ
  ✓ ok      Dung lượng trống                   còn 395.5 GB
  ✓ ok      Tuổi bản backup mới nhất           2.8 giờ kể từ bản gần nhất
  ✓ ok      Hạn chứng chỉ TLS                  còn 46 ngày

  Tổng thể: OK   (exit 0)
```

So với lần chạy đã lên lịch ngay trước đó (`logs/ops-alerts.log`, 2026-08-01T00:17:23Z) — **đúng một
nhóm đổi kết luận**, 7 nhóm còn lại giữ nguyên:

| Nhóm | Trước | Sau |
| --- | --- | --- |
| Lỗi ứng dụng trong log | `crit` — *1787 dòng lỗi trong cửa sổ* | `ok` — *0 dòng lỗi trong cửa sổ* |
| 7 nhóm còn lại | `ok` | `ok` (KI-050 đã đóng: backup 2.8 giờ) |

### Kết quả chạy thật — 2026-08-12 trên PROD (sau khi thêm rule #9–#11)

```text
OPS ALERT CHECK (IMPL-09 §18.3) — http://localhost:3100/api/v1 · cửa sổ 60 phút

  ✓ ok      Backend down                       /health 200 status=ok
  ✓ ok      DB connection/readiness            latency 7ms
  ! warn    Lệch migration (schema ↔ journal)  1 migration chưa áp — build mới đang ngồi trên schema cũ
  ✓ ok      Job nền thất bại                   0 lần chạy Failed trong cửa sổ
  ✓ ok      Lỗi ứng dụng trong log             0 dòng lỗi trong cửa sổ
  ✓ ok      Dung lượng trống                   còn 366.4 GB
  ✓ ok      Tuổi bản backup mới nhất           7.2 giờ kể từ bản gần nhất
  ✓ ok      Hạn chứng chỉ TLS                  còn 35 ngày
  ✓ ok      fbpost đăng bài (:3500)            HTTP 200 + dấu nhận dạng khớp
  ✓ ok      LMS đào tạo (:3400)                HTTP 200 + dấu nhận dạng khớp
  ✓ ok      Bản build Next đang phục vụ        2 app đều chạy bundle PROD

  Tổng thể: WARN   (exit 1)
```

`warn` lệch migration là **tồn đọng có sẵn từ trước** WO này (1 migration chưa áp trên PROD), không
phải do rule mới — cần owner xử lý riêng.

**Nghiệm thu bằng cách BẺ HỎNG chứ không bằng cách nhìn xanh** (chạy 12/08, ghi đè `OPS_SITES` để
dựng lại đúng từng chế độ hỏng — không chờ sự cố thật):

| Ca dựng lại | Kết quả | Exit |
| --- | --- | --- |
| Trang trả **500 mọi đường dẫn** (đúng sự cố fbpost 11–12/08) | `crit` — *HTTP 500 — trang chết* | 2 |
| Cổng đóng (dịch vụ dừng hẳn) | `crit` — *không ai trả lời (ECONNREFUSED) — dịch vụ dừng/treo* | 2 |
| HTTP 200 nhưng thân trang mất dấu nhận dạng (trang trắng) | `warn` | 1 |
| Trang công khai bị cổng phiên đá ra (307, **không follow**) | `warn` — *HTTP 307 — không phải 2xx* | 1 |
| `.next/static/development` + `webpack` (dấu `next dev`) | `crit` — *bundle DEV đang được next start phục vụ* | 2 |
| Bundle middleware đầy `eval(` (đúng nguyên nhân `EvalError`) | `crit` — như trên | 2 |
| App chưa build ⇒ không đọc được `.next` | `unknown` — KHÔNG ra xanh | 1 |
| `OPS_SITES=[]` hoặc JSON rác ⇒ không dò trang nào | `unknown` — *mù mà im lặng chính là lỗi đang vá* | 1 |

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
một dòng JSON vào `logs/ops-alerts.log` (như cũ, MỌI lần). Đẩy ra kênh chat (nếu đã đặt
`OPS_ALERT_WEBHOOK`) theo **chính sách chống spam** ở §4b — không còn gửi mỗi 10 phút.

**Bảng tác vụ lịch trên máy PROD** (đối chiếu bằng
`Get-ScheduledTask -TaskName MediaOS-* | Get-ScheduledTaskInfo`):

| Tác vụ | Chu kỳ | Chạy gì | `LastTaskResult` |
| --- | --- | --- | --- |
| `MediaOS-OpsAlert` | mỗi 10 phút | `node scripts\ops-alert-check.mjs --quiet` | `0` ok · `1` có warn/unknown (bình thường khi có nhóm warn) · `2` có crit · `3` lỗi cấu hình |
| `MediaOS-BackupDaily` | 02:00 hằng ngày | `scripts/backup-db.sh` qua Git Bash (xem RELEASE-11 §6.2) | `0` ok · khác 0 = **hỏng thật** |
| `MediaOS-DockerWatchdog` | lúc đăng nhập +90 giây, rồi mỗi 5 phút | `scripts\windows\docker-watchdog.ps1` (§4c) | `0` ổn/đã bật Docker · `1` lỗi script · `2` Docker Desktop chạy mà engine im quá ngưỡng · `3` không bật được Docker Desktop |

**Kiểm tra lịch đã chạy chưa:** `Get-ScheduledTask -TaskName MediaOS-*` + xem `logs/ops-alerts.log`.
Đo 2026-08-12: `MediaOS-OpsAlert` = `Ready`, chu kỳ 10 phút, `LastTaskResult` = 1 (warn) — **lịch CHẠY
THẬT**, không phải chỉ đăng ký.

---

## 4b. Đường BÁO ĐỘNG ra ngoài (S10-OPS-ALERTCHAN-1)

Sự cố 11–12/08 có **hai nửa**: (a) không đo `fbpost` — đóng bởi rule #9–#11 ở §3; (b) không có đường
báo ra ngoài. `logs/ops-alerts.log` là **bằng chứng, không phải kênh báo** — không ai mở nó lúc 3h
sáng. Nửa (b) đóng ở đây.

**Biến môi trường** (đặt vào env của **MÁY**, không phải `.env` theo git — URL webhook là SECRET,
BẤT BIẾN #3):

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `OPS_ALERT_WEBHOOK` | để bật kênh | URL webhook. Trống ⇒ không gửi đi đâu (chỉ ghi sổ) |
| `OPS_ALERT_WEBHOOK_FORMAT` | không | Ghi đè suy đoán kênh: `slack`·`google-chat`·`discord`·`telegram`·`generic`. Giá trị lạ ⇒ kêu ra stderr rồi suy theo host |
| `OPS_ALERT_TELEGRAM_CHAT_ID` | **có, nếu dùng Telegram** | Thiếu ⇒ báo lỗi ngay lúc dựng, KHÔNG gửi một request chắc chắn hỏng |
| `OPS_ALERT_TIMEOUT_MS` | không | Trần thời gian giao (mặc định 8000). Webhook treo **không** được treo scheduled task |
| `OPS_ALERT_REMIND_HOURS` | không | Nhắc lại sau bao nhiêu giờ khi vẫn hỏng y nguyên (mặc định `6`, nhận số lẻ). Giá trị rác (chữ, ≤ 0) ⇒ dùng `6` + kêu ra stderr |
| `OPS_ALERT_STATE` | không | Đường dẫn file trạng thái gửi. Mặc định `ops-alert-state.json` cùng thư mục với `OPS_ALERT_LOG` (tức `logs\`) |

### Chính sách gửi — chống spam mà KHÔNG nuốt cảnh báo (S19-OPS-PRODDBBOOT-1)

Bản trước gửi webhook **mỗi lần** kết quả ≠ ok, tức mỗi 10 phút. Một nhóm warn kéo dài (SITE_LMS kêu
oan từ 21/09) ⇒ ~144 tin/ngày ⇒ người nhận tắt tiếng kênh ⇒ sự cố thật kế tiếp im lặng. Nay chỉ gửi khi:

1. **Mức tổng (worst) đổi** — nặng lên hay nhẹ đi đều gửi.
2. **Tập nhóm không-ok hoặc độ nặng của một nhóm đổi** — kể cả khi worst giữ nguyên (nhóm thứ hai hỏng
   không được núp sau nhóm đầu). Chỉ đổi chi tiết (số đếm, latency) thì KHÔNG tính là đổi.
3. **Vẫn hỏng y nguyên quá `OPS_ALERT_REMIND_HOURS`** (mặc định 6 giờ) — tin ghi `NHẮC LẠI` ở dòng đầu.
4. **Về ok sau khi đã gửi tin không-ok** — đúng **một** tin `ĐÃ HỒI PHỤC` (kèm mức lần báo trước),
   nhưng chỉ khi đã ok **liên tục ≥ 20 phút** (`DEFAULT_RECOVERY_HOLD_MINUTES`). Lượt ok đầu chỉ ghi mốc
   `okSince`; hỏng lại giữa chừng thì xoá mốc. Nhờ vậy một nhóm chập chờn (warn · ok · warn …) không
   bắn cặp tin cảnh báo/hồi phục mỗi 10 phút. Hạn này chỉ **hoãn tin hồi phục**, không bao giờ hoãn
   một cảnh báo.
5. **Sổ gửi đọc lỗi mà hệ đang ok** — một tin `OK` trung tính (loại `resync`, không gọi là hồi phục)
   rồi ghi lại sổ, để kênh không treo mãi ở tin hỏng cũ. Sổ không ghi được ⇒ lặp mỗi lượt + kêu
   stderr (giống nhánh đang hỏng).

Mọi chỗ nghi ngờ nghiêng về **GỬI**: file trạng thái đọc lỗi hoặc hỏng ⇒ vẫn gửi + kêu stderr; mốc gửi
nằm ở tương lai (đồng hồ lùi) ⇒ gửi; **giao hỏng ⇒ KHÔNG ghi trạng thái** (lần chạy sau thử lại); ghi
trạng thái lỗi ⇒ kêu stderr (lần sau có thể gửi trùng — chấp nhận). `--test-alert` giữ nguyên: luôn
gửi, không đọc/ghi trạng thái. Chế độ bảng in thêm dòng `Webhook: ĐÃ GỬI|không gửi — <lý do>`.

**File trạng thái** `logs\ops-alert-state.json` — chỉ ghi sau một lần GỬI THÀNH CÔNG, ghi nguyên tử
(file tạm rồi rename; rename bị khoá tạm trên Windows ⇒ thử lại 2 lần rồi ghi thẳng file đích):
`worst` + danh sách `{id, severity}` không-ok + `sentAt` (+ `okSince` khi đang chờ đủ hạn hồi phục —
mốc này là chỗ duy nhất được ghi mà không kèm gửi). **Xoá file = quên lịch
sử gửi** ⇒ lần chạy kế tiếp đang hỏng sẽ gửi ngay (dùng khi muốn ép gửi lại, hoặc sau khi đổi kênh):

```powershell
Remove-Item "C:\dev 2\MediaOS\logs\ops-alert-state.json"
```

**Hình dạng thân khác nhau theo kênh** — gửi sai khoá thì tin bay mất mà phía ta không thấy lỗi:
Slack · Google Chat · kênh lạ dùng `{text}` · Discord dùng `{content}` · Telegram dùng
`{chat_id,text}`. Suy tự động từ host; xem `scripts/lib/ops-alert-notify.mjs`.

**Nghiệm thu kênh — KHÔNG chờ sự cố thật:**

```powershell
node scripts/ops-alert-check.mjs --test-alert
```

Gửi một tin thử **bất kể** hệ thống đang ok hay không, rồi in kết quả giao. Mã thoát của riêng cờ này
nói về KẾT QUẢ GIAO: `0` giao được · `2` giao hỏng (in mã HTTP + thân lỗi) · `3` chưa đặt webhook.
Đây là hàng rào chống bài học **KI-050** (`backup-db.sh` tồn tại từ G1-8 mà **chưa từng chạy** trên
PROD): script tồn tại ≠ script chạy được.

> HTTP 2xx chỉ chứng minh **kênh nhận**, chưa chứng minh **người thấy** — sai phòng hoặc sai
> `chat_id` vẫn trả 2xx. Nghiệm thu phải kèm nhìn mắt vào kênh chat.

**Giao hỏng thì KÊU TO.** Bản trước là `catch {}` trần, không kiểm `res.ok`, không timeout — URL sai
hoặc hết hạn ⇒ cảnh báo im lặng đi vào hư vô, đúng lớp lỗi mà cả WO này sinh ra để đóng. Nay mọi thất
bại giao để lại dấu ở **hai** nơi: `stderr` (Task Scheduler giữ) và một dòng
`{"kind":"alert-delivery-failed"}` trong `logs/ops-alerts.log`, kèm URL **đã che** (chỉ còn host).
Mã thoát của lệnh kiểm tra **không** đổi theo kênh chat: nó nói về sức khoẻ hệ thống.

> 🔴 **CÒN CHỜ OWNER (đo 2026-08-12).** Phần code đã xong: tin nhắn nói rõ đang hỏng cái gì, lỗi giao
> kêu to, có `--test-alert` để nghiệm thu. **Chưa làm được thay owner:** chọn kênh + tài khoản và đặt
> `OPS_ALERT_WEBHOOK` lên máy PROD. Chừng nào chưa đặt, nửa (b) **vẫn mở** — `fbpost` chết lại thì
> `ops-alert-check` SẼ ra `crit` exit 2 đúng lúc và **vẫn không ai biết**. Gỡ khối 🔴 này khi đã đặt
> webhook thật và `--test-alert` trả exit 0 + nhìn thấy tin trong kênh.

---

## 4c. Docker tự bật (S19-OPS-PRODDBBOOT-1)

**Nguyên nhân gốc (ngắn).** Postgres/PgBouncer/Valkey/MinIO PROD chạy trong Docker Desktop, mà Docker
Desktop chỉ được bật qua mục *Run* của tài khoản — do `explorer.exe` chạy. Explorer đã hai lần bỏ lỡ
mục Run: 13/10 (Explorer treo, bị Windows đóng, bản mới bỏ qua Run cho cả phiên ⇒ DB PROD vắng ~17
giờ) và 16/10 (màn hình khoá quá sớm sau khi tự đăng nhập ⇒ Explorer hoãn ứng dụng khởi động tới lần
mở khoá đầu). Task Scheduler chạy độc lập với Explorer và chạy cả khi màn hình khoá ⇒ đặt việc bật
Docker vào một tác vụ lịch thay vì trông vào Explorer.

**Watchdog** `scripts\windows\docker-watchdog.ps1` (PowerShell 5.1, UTF-8 có BOM):

- `docker info` trả lời ⇒ im lặng, thoát 0.
- Engine im **và** không có tiến trình `Docker Desktop` trong phiên ⇒ bật Docker Desktop, ghi `[ACTION]`.
- Engine im **nhưng** tiến trình còn ⇒ chỉ đếm giờ; quá 10 phút ghi `[WARN]` (tối đa mỗi 60 phút),
  thoát 2. **Không diệt gì** (chỉ dừng đúng tiến trình `docker info` con của chính nó khi quá hạn).
- Engine trả lời lại sau một lần `[ACTION]`/`[WARN]` ⇒ ghi `[RECOVERED]`.
- Chỉ ghi `logs\docker-watchdog.log` khi có hành động hoặc lỗi (xoay ở 1 MB). Trạng thái tạm:
  `logs\docker-watchdog.state`.
- **Đường báo động của chính watchdog:** luật `DOCKER_WATCHDOG` của `ops-alert-check` đọc đuôi log này
  trong cửa sổ 60 phút — `[ERROR]` (không bật được Docker / script lỗi) ⇒ crit, `[WARN]` (engine kẹt /
  cờ tạm dừng quá hạn) ⇒ warn, chưa có log ⇒ ok (máy khoẻ thì watchdog không ghi gì), đọc lỗi khác ⇒
  unknown. Nhờ vậy watchdog hỏng đi qua cùng webhook với mọi luật khác. Đổi đường dẫn:
  `OPS_DOCKER_WATCHDOG_LOG`.
- **Tác vụ KHÔNG giới hạn thời gian chạy** (`ExecutionTimeLimit` = `PT0S`). Docker Desktop được bật từ
  chính cây tiến trình của tác vụ; nếu Task Scheduler giữ tác vụ `Running` theo tiến trình con thì một
  giới hạn N phút sẽ diệt luôn Docker vừa bật. Chưa đo được trước khi đăng ký — xem bước đo sau merge.
  Không giới hạn thì trường hợp xấu nhất chỉ là các lượt 5 phút bị `IgnoreNew` bỏ qua khi Docker còn
  sống; `docker info` có hạn giờ riêng nên watchdog không treo lâu.

**Đăng ký / gỡ** (PowerShell thường của tài khoản chạy dịch vụ, KHÔNG cần Admin; tác vụ chạy
Interactive vì Docker Desktop là ứng dụng của phiên đăng nhập — session 0 không bật được nó). Script
đăng ký từ chối thư mục nằm trong `%TEMP%` hoặc worktree — tác vụ phải trỏ vào **cây chính**:

```powershell
$reg = "C:\dev 2\MediaOS\scripts\windows\register-docker-watchdog.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File $reg -DryRun       # xem kế hoạch, không đăng ký
powershell -NoProfile -ExecutionPolicy Bypass -File $reg               # đăng ký + chạy thử 1 lần; exit 1 nếu chạy thử hỏng/chưa xác minh
powershell -NoProfile -ExecutionPolicy Bypass -File $reg -Unregister   # gỡ
```

**Tạm dừng** khi bảo trì Docker (vd cố ý tắt Docker Desktop — nếu không watchdog bật lại trong ≤ 5 phút).
Cờ **có hạn 8 giờ** tính từ lúc tạo/sửa file (`-PauseMaxHours`): còn hạn ⇒ ghi một dòng `[PAUSE]`; quá
hạn ⇒ bị bỏ qua, ghi `[WARN]` mỗi lượt (ra webhook qua `DOCKER_WATCHDOG`) — quên xoá cờ không được
tắt watchdog trong im lặng. Bảo trì lâu hơn: tạo lại file (đặt lại hạn).

```powershell
New-Item -ItemType File "C:\dev 2\MediaOS\logs\docker-watchdog.pause"   # tạm dừng
Remove-Item "C:\dev 2\MediaOS\logs\docker-watchdog.pause"               # chạy lại
```

**Diễn tập** (không bật/không ghi gì — chỉ in việc SẼ làm):

```powershell
$wd = "C:\dev 2\MediaOS\scripts\windows\docker-watchdog.ps1"
powershell -NoProfile -File $wd -DryRun                                          # trạng thái thật, exit 0 khi engine trả lời
powershell -NoProfile -File $wd -DryRun -SimulateEngineDown -SimulateNoProcess   # nhánh bật Docker: in "DRYRUN se chay: Start-Process ..."
```

`-Simulate*` chỉ được dùng kèm `-DryRun` (thiếu ⇒ script tự chặn: ghi một dòng `[ERROR]`, exit 1). Đo 16/10/2026 từ worktree:
cả hai lệnh exit 0; bản tạm của tác vụ (đăng ký 16/10 16:19) có `LastTaskResult` = 0.

> **Sau khi merge** (owner): `git pull` cây chính → chạy lại lệnh đăng ký ở trên (ghi đè tác vụ để trỏ
> vào `scripts\windows\docker-watchdog.ps1`; lệnh exit 0 nghĩa là lần chạy thử đã chạy xong với kết quả
> 0 hoặc 2) → xoá bản tạm ở `logs\interim\`.
>
> **Đo một lần khi watchdog bật Docker thật** (lần `[ACTION]` đầu, hoặc diễn tập có chủ đích lúc ngoài
> giờ: tạo cờ tạm dừng → thoát Docker Desktop → xoá cờ): sau ~5 phút,
> `Get-ScheduledTask MediaOS-DockerWatchdog` phải về `Ready` và Docker Desktop vẫn sống. Nếu tác vụ
> cứ `Running` trong khi Docker sống ⇒ Task Scheduler giữ tác vụ theo tiến trình con: Docker không bị
> diệt (không có giới hạn thời gian) nhưng các lượt kiểm bị bỏ qua — ghi lại và mở WO tách tiến trình.

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
| **Xoay log (chống phình đĩa)** | ✅ **ĐÃ BẬT trên PROD 2026-08-01** | NSSM xoay khi > 32 MB hoặc quá 1 ngày, xoay được cả khi đang chạy. Dọn: `scripts\windows\08-log-rotate.ps1`. Cài mới tự bật qua `04-build-install-service.ps1` |
| **Log có cấu trúc JSON** | ✅ **ĐÃ XONG 2026-08-13** | `JsonConsoleLogger` (kế thừa `ConsoleLogger` built-in Nest 11, `json:true`) đăng ký một lần ở `main.ts` — đóng **KI-009** (`S10-FND-JSONLOG-1`) |

> 🔴 **Đo 2026-08-01 TRƯỚC khi vá — service `MediaOS-API` TẮT hoàn toàn xoay log:** `AppRotateFiles` ·
> `AppRotateOnline` · `AppRotateBytes` · `AppRotateSeconds` đều `= 0` ⇒ hai file log **chưa từng được
> xoay** kể từ ngày cài (dòng đầu `api.out.log` là lần khởi động 18/06). Hậu quả đo được:
> `api.out.log` = **688 MB** (lấy mẫu 8MB giữa file: **99 %** là dòng `RetentionCleanupJob` lặp lại),
> `api.err.log` = 2 MB. Bản vá 24/07 là cắt tay (`api.err.log.2026-07-24-truncated-tail`) — tức chuyện
> này đã xảy ra một lần và **không có gì chặn nó lặp lại**.
>
> ✅ **Đã xử lý 2026-08-01** bằng `08-log-rotate.ps1 -Configure`:
>
> ```text
> tong log truoc: 690.8 MB   (api.out.log 688.5 MB · api.err.log 2.1 MB)
>   [OK] Da dat: xoay khi > 32 MB hoac qua 1 ngay, xoay duoc ca khi dang chay
>   [OK] API song lai sau restart
>   [OK] cat api.out-20260801T031432.052.log: 688.5 MB -> 10.0 MB
> tong log sau : 12.3 MB   (giai phong 678.4 MB)
> ```
>
> `data.build` **giống hệt trước và sau restart** (`14306b8a-dirty` · `builtAt 2026-08-01T00:11:47Z`)
> — restart, KHÔNG phải rebuild. Bản 688 MB không bị xoá: nó được cắt giữa, giữ 2 MB đầu + 8 MB đuôi
> trong `api.out-20260801T031432.052.trimmed.log`.
>
> 🔬 **Bằng chứng cuối cùng cho rule #5:** ngay lần restart này, `api.err.log` có `mtime` nhảy lên
> 10:14 trong khi kích thước **không đổi một byte** (2 179 073 B) — NSSM mở file để ghi tiếp là đã đủ
> làm mới `mtime`. Đúng cơ chế sinh ra con số 1787 giả. Cách bật + dọn định kỳ: `RELEASE-11` §6.2b.

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
| §18.4 Logging | 8/9 | 9/9 (JSON log đã xong — `S10-FND-JSONLOG-1`, đóng KI-009 2026-08-13) |
| §18.5 Support readiness | ❌ | ✅ quy trình xong; **guide nội dung → `S6-GOLIVE-1`** |
| §18.6 Hypercare | ❌ | ✅ có kế hoạch + điều kiện thoát |
