# RELEASE-11 — ADMIN GUIDE (HANDOFF-007)

> Work Order **`S6-GOLIVE-1`** · `IMP09-HANDOFF-007` · `IMP09-IN-017`
> Người nhận: **Admin · HR · Super Admin** · Soạn: 2026-07-31 · build tham chiếu `1.0.0-rc.1`
>
> **Quy tắc của guide này: chỉ mô tả màn hình CÓ THẬT.** Mỗi đường dẫn dưới đây truy được về một
> `path:` trong `apps/*/src/router.tsx`. Chức năng chưa có thì ghi **CHƯA CÓ**, không mô tả cho đủ mặt.
> Nghiệp vụ chi tiết (rule · mã lỗi · máy trạng thái) là của `docs/spec/` — guide này chỉ chỉ đường.

---

## 1. Ba ứng dụng — vào đâu làm gì

Hệ thống là **3 SPA riêng biệt**, dùng chung một phiên đăng nhập (cookie theo domain
`.funtimemediacorp.com`). Nhầm app là nguyên nhân "tôi không thấy menu đó" phổ biến nhất.

| Ứng dụng | Địa chỉ | Dành cho | Nội dung chính |
| --- | --- | --- | --- |
| **App nghiệp vụ** | `funtimemediacorp.com` | Mọi người | Dashboard · HR · Chấm công · Nghỉ phép · Công việc · Mục tiêu · Thông báo · Tài khoản của tôi |
| **Console quản trị** | `console.funtimemediacorp.com` | Admin · Super Admin | Cấu hình công ty · Phân quyền · Cơ cấu tổ chức · Người dùng · API key · Webhook · Nhật ký · Thùng rác · **Bảo mật tài khoản (2FA)** |
| **Đăng nhập** | `auth.funtimemediacorp.com` | Mọi người | Đăng nhập · quên/đổi mật khẩu · bước 2FA |
| *(đào tạo)* | `train.funtimemediacorp.com` | Mọi người | LMS — đăng nhập bằng SSO từ hệ thống này |

> **Có HAI chỗ bật 2FA, cả hai đều thật:** App `/me/security/2fa` (trong workspace "Của tôi") và
> Console `/settings/security`. Dùng chỗ nào cũng được — chúng thao tác trên cùng một TOTP.
> Ngoài ra `/account/setup-2fa` là màn **bị ép** enroll (hệ thống tự đá tới khi tài khoản buộc phải bật).

---

## 2. Vai trò & phân quyền

### 2.1 Vai đang dùng thật (đo trên PROD 2026-07-31)

| Vai | Số quyền | Số người | Ép 2FA | Ghi chú |
| --- | ---: | ---: | --- | --- |
| `SA` (Super Admin) | **379/379** | 6 | ❌ **không** | Toàn quyền công ty. Xem cảnh báo §3.1 |
| `company-admin` | 329 | 1 | ✅ có | Quản trị công ty |
| `employee` | 67 | 45 | ❌ | Vai mặc định của nhân viên |
| `hr` · `hr-manager` · `manager` · `project-manager` | 128 · 53 · 79 · 39 | 0 | ❌ | **Đã seed nhưng chưa gán cho ai** |
| `channel-manager` · `editor` · `finance-manager` · `qa-reviewer` · `script-writer` · `uploader` | 9–25 | 0 | ❌ | **Di sản hướng media — ngoài phạm vi sản phẩm**, chờ dọn (`RELEASE-14` `PGL-006`) |

> Hôm nay gần như mọi người là `employee` và mọi việc quản trị đi qua 6 tài khoản `SA`. Muốn HR/quản lý
> tự làm việc của họ mà không cần toàn quyền, hãy gán `hr` / `manager` — các vai đó đã có sẵn quyền.

### 2.2 Cách phân quyền hoạt động

- Quyền là **cặp** `MODULE.RESOURCE.ACTION` (vd `hr.employee.read`).
- Mỗi cặp gắn với một **phạm vi dữ liệu** (`data_scope`): `Own` · `Team` · `Department` · `Company` · `System`.
- **Phạm vi đặt theo từng cặp (permission, role)** — cùng một vai có thể đọc `Company` nhưng chỉ sửa `Own`.
- Backend là lớp quyết định cuối (fail-closed). Ẩn nút trên giao diện **không** phải là kiểm soát quyền.

**Màn hình:** `console.funtimemediacorp.com/system/permissions` · vai và gán vai:
`funtimemediacorp.com/system/roles` · `…/system/roles/$roleId/permissions`.

> Đổi phạm vi của một cặp là **xoá rồi thêm lại**, không phải sửa tại chỗ — sau khi đổi, bảo người dùng
> **đăng xuất/đăng nhập lại** để phiên nhận quyền mới.

---

## 3. Bảo mật tài khoản

### 3.1 ⚠️ Việc cần làm NGAY: bật 2FA cho các tài khoản `SA`

Hiện **4/6** tài khoản `SA` — mỗi tài khoản nắm đủ 379 quyền, đọc được hồ sơ nhân sự chưa che — **chưa
bật xác thực 2 bước**. Đây là `KI-056` (`RELEASE-10` §4) và là một trong các điều kiện chặn go-live.

**Thứ tự đúng (đảo là tự khoá mình ra ngoài):**

1. Từng người `SA` vào **App `/me/security/2fa`** (hoặc Console `/settings/security`) → bật 2FA → quét
   mã bằng ứng dụng xác thực (Google Authenticator · Microsoft Authenticator · Authy) → nhập mã 6 số
   để xác nhận.
2. **Lưu mã khôi phục** vào nơi an toàn ngoài máy — mất điện thoại mà không có mã khôi phục thì phải
   nhờ `SA` khác gỡ 2FA hộ.
3. Chỉ **sau khi cả 4 người đã enroll xong**, mới cân nhắc bật cờ bắt buộc 2FA cho vai `SA`.

> ⚠️ Bật cờ bắt buộc **trước** khi enroll ⇒ những tài khoản chưa enroll bị chặn **403 ở mọi màn hình**
> ngay lập tức (đúng thiết kế, nhưng nhìn hệt như "hệ thống sập toàn bộ").

### 3.2 Các màn bảo mật khác

| Việc | Ở đâu |
| --- | --- |
| Tự bật/tắt 2FA của mình | App `/me/security/2fa` · Console `/settings/security` |
| Màn bị ép bật 2FA (hệ thống tự đá tới) | App `/account/setup-2fa` |
| Hồ sơ + đổi mật khẩu của mình | App `/me/profile` · `/me/security/password` · `/account/change-password` · Console `/settings/account` |
| Xem/thu hồi phiên đăng nhập của mình | App `/account/sessions` |
| Chính sách bảo mật công ty (độ mạnh mật khẩu, khoá tài khoản…) | Console `/settings/security-policy` |
| Nhật ký đăng nhập · sự kiện bảo mật · truy cập tệp | App `/system/login-logs` · `/system/security-events` · `/system/file-access-logs` |
| Break-glass (mở khoá khẩn cấp theo từng đối tượng) | Console `/settings/break-glass` |

---

## 4. Công việc quản trị thường ngày

### 4.1 Người dùng & nhân sự

| Việc | Màn hình |
| --- | --- |
| Thêm người dùng | App `/system/users/new` · Console `/system/users` |
| Gán vai cho người dùng | App `/system/users/$userId/roles` |
| Thêm hồ sơ nhân viên | App `/hr/employees/new` |
| **Nhập nhân viên hàng loạt** | App `/hr/employees/import` |
| Sơ đồ tổ chức | App `/hr/org-chart` |
| Phòng ban · chức danh · cấp bậc | App `/hr/departments` · `/hr/positions` · `/hr/job-levels` · Console `/system/org-structure` |
| Quy tắc sinh mã nhân viên | App `/hr/settings/employee-code` |
| Hợp đồng + cảnh báo sắp hết hạn | App `/hr/contracts` · `/hr/contract-types` |
| **Duyệt yêu cầu sửa hồ sơ** | App `/hr/profile-change-requests` |
| Khôi phục dữ liệu đã xoá mềm | Console `/recycle-bin` |

> Nhân viên **không sửa thẳng** hồ sơ của mình — họ gửi *yêu cầu sửa hồ sơ*, HR/Admin duyệt. Đó là lý do
> có màn `profile-change-requests`.

### 4.2 Chấm công & nghỉ phép

| Việc | Màn hình |
| --- | --- |
| Bảng công toàn công ty | App `/attendance/records` |
| Ca làm · phân ca · quy tắc chấm công | App `/attendance/shifts` · `/attendance/shift-assignments` · `/attendance/rules` |
| Duyệt đơn điều chỉnh công | App `/attendance/adjustment-requests` |
| Duyệt đăng ký làm từ xa | App `/attendance/remote-work-requests` |
| Báo cáo + xuất dữ liệu chấm công | App `/attendance/reports` |
| Loại phép · chính sách · số dư | App `/leave/types` · `/leave/policies` · `/leave/balances` |
| Ngày lễ | App `/leave/public-holidays` |
| Báo cáo nghỉ phép | App `/leave/reports` |

> **Người duyệt không được tự duyệt đơn của chính mình** — hệ thống chặn ở backend, không phải chỉ ẩn nút.

### 4.3 Hệ thống

| Việc | Màn hình |
| --- | --- |
| Cấu hình công ty (tên, logo, favicon) | Console `/settings/company` |
| Cấu hình email | Console `/settings/mail-config` |
| Danh mục module | App `/system/modules` |
| Job nền + lần chạy · sức khoẻ hệ thống | App `/system/jobs` · `/system/health` |
| Cấu hình hệ thống · vòng đời dữ liệu · seed · dải số | App `/system/settings` · `/system/retention` · `/system/seeds` · `/system/sequences` |
| Tệp đã tải lên | App `/system/files` |
| Nhật ký kiểm toán | App `/system/audit-logs` · `/hr/audit-logs` · `/leave/audit-logs` · `/attendance/audit-logs` · Console `/system/activity-log` |
| API key · Webhook | Console `/system/api-keys` · `/system/webhooks` |
| 🔒 Đọc-vượt hội thoại · nhật ký đọc-vượt | Console `/system/chat-oversight` · `/system/chat-oversight/audit` (xem §4.4) |

### 4.4 🔒 Đọc-vượt hội thoại (chat) — ranh giới riêng tư, công bố tường minh

Chat trong hệ thống này mặc định **chỉ thành viên phòng đọc được**. Có **đúng một ngoại lệ**, và đây là
chỗ công bố nó — chứ không để nó nằm im trong code (SPEC-15 §3.3):

- **Phạm vi thật:** người giữ quyền `view:chat-oversight` mở được **mọi phòng**, **bao gồm cả phòng nhắn
  riêng (tin nhắn 1-1) giữa hai người khác**. Đừng nói với nhân viên rằng "tin nhắn riêng không ai đọc
  được" — câu đúng là "tin nhắn riêng chỉ đọc được bởi tài khoản có quyền đọc-vượt, và mỗi lần đọc đều
  để lại dấu vết mang tên người đọc".
- **Quyền này KHÔNG cấp cho vai nào theo mặc định** — kể cả Quản trị công ty / BOD. Chỉ Super Admin, và
  chỉ khi được cấp tường minh (cặp quyền nhạy cảm, không rơi vào grant wildcard).
- **Chỉ đọc.** Không gửi, không ghim, không thu hồi, không sửa thành viên, **không tải được tệp đính
  kèm** (chỉ thấy tên · cỡ · loại tệp). Tin đã thu hồi vẫn bị che.
- **Không có tìm kiếm toàn công ty.** Tra cứu phòng theo mã/tên (tối thiểu 2 ký tự) rồi mở **đích danh**
  một phòng — không có đường liệt kê hay tìm nội dung xuyên mọi phòng cho bất kỳ ai.
- **Mọi lần dùng đều được ghi**, kể cả lần **bị từ chối**. Xem tại Console `/system/chat-oversight/audit`
  (ai · phòng nào · lúc nào · thành công/bị từ chối · đã tra bằng tiêu chí gì).
- **Bộ lọc của màn nhật ký chỉ áp trên các dòng đã tải** — bấm "Tải thêm" trước khi kết luận "không có
  lần truy cập nào". Màn hình có nhãn ghi rõ số dòng đang lọc trên tổng số đã tải.

> Nếu công ty **không muốn** ai đọc-vượt được: thu hồi cặp `view:chat-oversight` khỏi mọi tài khoản
> (Console `/system/permissions`). Lối vào biến mất khỏi menu và mọi lời gọi trả 403 — có ghi nhật ký.

---

## 5. Đọc nhật ký kiểm toán

Nhật ký kiểm toán là **chỉ-ghi-thêm** — không ai sửa hay xoá được, kể cả Super Admin. Đó là chủ ý: nếu
sửa được thì nó không còn là bằng chứng.

Mỗi phản hồi của hệ thống đều mang một **`request_id`**. Khi có sự cố, `request_id` là chìa khoá lần
ngược từ màn hình người dùng → dòng log máy chủ. Luôn hỏi người báo lỗi con số này (`RELEASE-13` §2).

---

## 6. Vận hành máy chủ (người có quyền trên máy PROD)

### 6.1 Kiểm tra nhanh

```powershell
m prod-status        # service · cổng · migration tồn đọng · artifact release · health
```

```bash
node scripts/ops-alert-check.mjs     # 8 nhóm cảnh báo, đọc-only
```

Hệ thống đang chạy bản nào — hỏi thẳng nó:

```bash
curl -s http://localhost:3100/api/v1/health   # data.build = {version, commit, builtAt, migrationHead}
```

> Bài học đã trả giá: **restart ≠ rebuild**. PID mới, log mới, env mới đều có thể vẫn đang chạy code cũ.
> Chỉ `data.build` mới trả lời được câu "máy chủ đang chạy bản nào".

### 6.2 Đăng ký lịch tự động (cần **Administrator**)

⚠️ Lệnh ở `RELEASE-09` §4 **thiếu biến môi trường** ⇒ task backup sẽ chạy rồi thoát ngay vì không có
`DATABASE_DIRECT_URL` (Task Scheduler không đọc `.env` của repo). Bản đã sửa:

> **Đính chính 2026-08-03 — đã CHẠY THẬT, không phải đọc mà tin.** Bản `set -a; . ./.env; set +a` ở
> dưới **có chạy** (dump `4 247 941` byte trong ~1s) nhưng in 2 dòng lỗi và **nạp thiếu 2 biến**:
> `bash` coi `.env` là script, nên dòng có DẤU CÁCH hoặc BACKSLASH trong giá trị bị tách từ
> (`KMS_LOCAL_KEK_PATH=C:\dev 2\MediaOS\.secrets\local-kek.bin` → `2MediaOS.secretslocal-kek.bin:
> command not found`; `ADMIN_COMPANY_NAME` cũng vậy). Backup **không** cần hai biến đó nên vẫn đúng
> — nhưng ai sao khuôn idiom này cho một task CẦN `KMS_LOCAL_KEK_PATH` sẽ hỏng IM LẶNG lúc 02:00.
> **Dùng bản chỉ đọc ĐÚNG khoá cần** (đã chạy thật, 0 dòng lỗi):
>
> ```powershell
> $b = New-ScheduledTaskAction -Execute $bash `
>      -Argument '-lc "export DATABASE_DIRECT_URL=\"$(sed -n \"s/^DATABASE_DIRECT_URL=//p\" .env | head -n1)\"; BACKUP_DIR=./backups ./scripts/backup-db.sh"' `
>      -WorkingDirectory $repo
> ```

```powershell
# PowerShell Administrator, tại gốc repo
$repo = "C:\dev 2\MediaOS"
# ⛔ ĐỪNG dùng `(Get-Command bash).Source` — ĐÃ HỎNG THẬT 2026-08-04. Trên máy PROD này nó trả
#    C:\WINDOWS\system32\bash.exe = shim WSL, mà WSL KHÔNG có bash cài trong đó:
#      execvpe(/bin/bash) failed: No such file or directory
#    Task vẫn đăng ký THÀNH CÔNG và State=Ready, chỉ đến 02:00 mới hỏng — im lặng, đúng khuôn KI-050.
#    Bản cũ của dòng này còn tự trấn an "KHÔNG hard-code \Git\bin\", tức lời khuyên đó CHÍNH LÀ lỗi.
$bash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $bash)) { throw "Khong thay Git Bash tai $bash - kiem lai truoc khi dang ky task" }

# Cảnh báo vận hành mỗi 10 phút
$a = New-ScheduledTaskAction -Execute "node.exe" `
     -Argument "scripts\ops-alert-check.mjs --quiet" -WorkingDirectory $repo
$t = New-ScheduledTaskTrigger -Once -At (Get-Date) `
     -RepetitionInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "MediaOS-OpsAlert" -Action $a -Trigger $t -RunLevel Highest `
     -Description "IMPL-09 §18.3 — canh bao van hanh MediaOS"

# Backup hằng ngày 02:00 — NẠP .env TRƯỚC khi gọi script (đây là phần RELEASE-09 §4 thiếu)
$b = New-ScheduledTaskAction -Execute $bash `
     -Argument '-lc "set -a; . ./.env; set +a; BACKUP_DIR=./backups ./scripts/backup-db.sh"' `
     -WorkingDirectory $repo
$bt = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName "MediaOS-BackupDaily" -Action $b -Trigger $bt -RunLevel Highest `
     -Description "Backup DB PROD hang ngay (KI-050)"
```

**Kiểm lịch đã chạy chưa** — đừng tin là đã đăng ký thì tức là đã chạy:

```powershell
Get-ScheduledTask -TaskName MediaOS-*
Start-ScheduledTask -TaskName MediaOS-BackupDaily    # chạy thử NGAY một lần
Get-ChildItem backups\                               # phải thấy file .dump mới

# BẮT BUỘC: đọc kết quả lần chạy, KHÔNG dừng ở "State=Ready"
Get-ScheduledTask -TaskName MediaOS-* | Get-ScheduledTaskInfo |
  Select-Object TaskName, LastRunTime, LastTaskResult
```

**Đọc `LastTaskResult` cho đúng** — đây là chỗ dễ kết luận ngược:

| Giá trị | Nghĩa |
| --- | --- |
| `267011` (`0x41303`) | **CHƯA CHẠY LẦN NÀO.** Không phải "ổn". Vừa đăng ký xong luôn là số này |
| `0` | chạy xong, exit 0 |
| `1` ở `MediaOS-OpsAlert` | **BÌNH THƯỜNG** — `ops-alert-check.mjs` trả `1` khi có nhóm `warn`. Không phải task hỏng |
| `1` ở `MediaOS-BackupDaily` | **HỎNG THẬT** — script backup trả 0 khi thành công |

⚠️ **`State = Ready` KHÔNG chứng minh gì.** Task trỏ tới một `bash.exe` không chạy được vẫn hiện
`Ready` và vẫn đăng ký thành công; nó chỉ hỏng lúc trigger nổ. Verify bằng `LastTaskResult` + file
`.dump` mới, không bằng `State`.

### 6.2b Xoay log

> ✅ **Đã bật trên PROD 2026-08-01** — 690.8 MB → 12.3 MB (giải phóng 678.4 MB). Mục này giữ lại để
> dựng lại máy khác, hoặc khi `nssm get` cho thấy xoay log bị tắt.

Trước đó service NSSM để cả 4 tham số xoay log = `0` ⇒ hai file log **chưa từng được xoay** kể từ ngày
cài, `api.out.log` phình tới **688 MB**. Bản cài mới đã tự bật (`04-build-install-service.ps1`); service
**đang chạy** thì phải bấm tay:

```powershell
# 1) Xem sẽ làm gì, KHÔNG đụng file
powershell -File scripts\windows\08-log-rotate.ps1 -DryRun

# 2) Bật xoay + xử lý file đang phình — CẦN Administrator
#    ⚠️ Lệnh này RESTART service ⇒ API gián đoạn ~10-20 giây. Chọn giờ vắng.
powershell -File scripts\windows\08-log-rotate.ps1 -Configure
```

> **Vì sao phải restart:** NSSM chỉ đọc tham số I/O lúc khởi động — không restart thì cấu hình nằm im
> trong registry. Đổi lại, chính lúc khởi động NSSM xoay ngay file đang vượt ngưỡng, nên đây cũng là
> đường xử lý file 688 MB. Sau khi bật, NSSM tự xoay khi file > 32 MB hoặc quá 1 ngày.
>
> **Sau restart, kiểm `data.build` phải GIỐNG HỆT trước đó** (§6.1) — restart không được làm đổi bản
> đang chạy. Bản log cũ KHÔNG bị xoá: nó bị cắt giữa, giữ 2 MB đầu + 8 MB đuôi trong `*.trimmed.log`.

Dọn định kỳ (**không** cần Administrator, **không** restart gì) — giữ 5 bản xoay mỗi luồng, cắt bản
> 64 MB thành `.trimmed.log` giữ đầu + đuôi:

```powershell
$repo = "C:\dev 2\MediaOS"
$l = New-ScheduledTaskAction -Execute "powershell.exe" `
     -Argument "-NoProfile -File scripts\windows\08-log-rotate.ps1" -WorkingDirectory $repo
$lt = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "MediaOS-LogRotate" -Action $l -Trigger $lt `
     -Description "Don log NSSM (S6-OPS-LOGWINDOW-1)"
```

**Kiểm nhanh xem xoay đã bật chưa:**

```powershell
foreach ($p in 'AppRotateFiles','AppRotateOnline','AppRotateBytes','AppRotateSeconds') {
  "$p = $(nssm get MediaOS-API $p)"      # cả 4 = 0 nghĩa là CHƯA bật
}
```

### 6.3 Backup & khôi phục

```bash
# Backup thủ công (chạy được kể cả khi máy không có pg_dump — tự dùng client trong container)
DATABASE_DIRECT_URL="…" BACKUP_DIR=./backups bash scripts/backup-db.sh

# Chứng minh bản backup KHÔI PHỤC ĐƯỢC (restore vào DB tạm rồi tự dọn — không đụng DB thật)
DATABASE_DIRECT_URL="…" bash scripts/backup-restore-drill.sh
```

**Giới hạn phải biết** (`RELEASE-10` §7.2):

- Backup hiện **chỉ nằm trên chính máy đó** và **chưa mã hoá**. Máy hỏng là mất cả hai bản. Đặt
  `BACKUP_GPG_RECIPIENT` để bật mã hoá và `BACKUP_B2_REMOTE` để đẩy ra ngoài.
- Chưa có PITR ⇒ hỏng DB có thể mất tới **24 giờ** dữ liệu gần nhất.
- Thư mục `backups/` đã được gitignore. **Đừng bao giờ commit file dump** — nó chứa PII toàn công ty và
  repo này công khai.

### 6.4 Cập nhật hệ thống

Thứ tự trong `RELEASE-08` §4 là **bắt buộc**, không phải gợi ý:

```powershell
m dev-online-stop     # tránh xung đột thư mục build
# backup trước (§6.3)
m prod-update fe      # frontend
m prod-update api     # build → snapshot → MIGRATE → restart (không migrate xong thì không restart)
m prod-update lms
node scripts/release-smoke.mjs --expect-commit <sha>    # BẮT BUỘC có --expect-commit
```

Quay lui khi hỏng: `m prod-rollback` (`RELEASE-08` §5).

> `--expect-commit` không phải tuỳ chọn cho vui. Thiếu nó, smoke xanh chỉ chứng minh "có một hệ thống
> nào đó đang chạy tốt" — không chứng minh nó đang chạy **bản bạn vừa deploy**.

---

## 7. Khi có sự cố

1. `m prod-status` + `node scripts/ops-alert-check.mjs` — xem hệ thống tự nói gì trước.
2. Không đăng nhập được / nghi lộ dữ liệu / nghi mất dữ liệu → **P0**: xử lý ngay, cân nhắc rollback.
3. Thu thập `request_id` + ảnh chụp + giờ xảy ra (mẫu ở `RELEASE-13` §2).
4. Log máy chủ: `logs\api.err.log` · `logs\api.out.log` · `logs\ops-alerts.log`.
5. Ngưỡng phản hồi và đường leo thang: `RELEASE-09` §6.1.

---

## 8. Việc quản trị **CHƯA CÓ** trong bản này

Ghi thẳng để không ai đi tìm màn hình không tồn tại:

| Mong đợi | Trạng thái |
| --- | --- |
| Bảng lương / phiếu lương | ❌ Phase 2 (ngoài phạm vi MVP) |
| Tuyển dụng · tài sản · phòng họp · chat | ❌ Phase 2–4 |
| Đổi phạm vi dữ liệu bằng giao diện kéo-thả | ❌ dùng màn phân quyền theo cặp |
| Tự phục hồi 2FA khi mất cả điện thoại lẫn mã khôi phục | ❌ phải nhờ `SA` khác gỡ |
| Log dạng JSON có cấu trúc | ❌ `KI-009` — đang là log dạng văn bản |
| Cảnh báo đẩy ra kênh chat | ⚠️ có hỗ trợ (`OPS_ALERT_WEBHOOK`) nhưng **chưa cấu hình** |
