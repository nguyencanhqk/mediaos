# S10-SOCIAL-OPS-1 — Kho fbpost sang ổ D: · tài khoản dịch vụ · sao lưu tách KEK

> Zone **đỏ** · layer DEVOPS · nhánh `auto/S10-SOCIAL-OPS-1` off `master@5d718590`.
> Phiên chạy **song song** với S10-AUTH-IPTRUST-1 (phiên khác giữ main worktree) — xem §6.

## 1. Đo lại hiện trạng (18/08/2026) — KHÁC số đo lúc seed WO (06/08)

| Thứ | Số đo 06/08 (trong WO) | **Đo lại 18/08** | Hệ quả |
| --- | --- | --- | --- |
| `apps/fbpost/data/` | "gần trống, uploads = 0 byte, db 4KB" | **2.8 GB** (7 video, lớn nhất 536 MB) | Vẫn nên dời, nhưng KHÔNG còn là thao tác "rẻ như không" — phải copy thật + nghiệm thu thật |
| Ổ C: trống | 410.8 GB | **370.2 GB** (giảm 40 GB trong 12 ngày) | Xu hướng đúng như dự đoán của WO |
| Ổ D: trống | 1407.1 GB | **1298.7 GB** | Thừa sức chứa |
| `SOCIAL_DATA_DIR` | chưa đặt | **vẫn chưa đặt** (grep 0 hit ở `.env`, `.env.prod`, `apps/fbpost/.env.production`) | `paths.ts:11` rơi về `process.cwd()/data`; `nssm get AppDirectory` = `C:\dev 2\MediaOS\apps\fbpost` ⇒ kho đang ở ổ C: |
| `MediaOS-Social` StartName | LocalSystem | **vẫn LocalSystem**, State=Running | xem §2 |
| `scripts/windows/09-social-media-library.ps1` | — | **ĐÃ TỒN TẠI từ 06/08, CHƯA TỪNG CHẠY** | Bài học [[known-issue-workaround-may-never-have-run]] lặp lại nguyên si: script viết xong, không ai bấm |

Sao lưu hiện có (`Get-ScheduledTask`): `MediaOS-BackupDaily` 02:00 gọi `scripts/backup-db.sh` — **chỉ Postgres**.
`apps/fbpost/data/` và `apps/fbpost/.secrets/fbpost-kek.bin` **không nằm trong bất kỳ đường sao lưu nào**.

## 2. Đổi phạm vi: BỎ việc đổi tài khoản chạy dịch vụ (owner chốt 18/08)

WO viết "đổi dịch vụ từ LocalSystem sang tài khoản Windows có quyền trên share LAN". Lý do gốc đó
**đã bị code thay thế** giữa lúc seed WO và bây giờ:

- `apps/fbpost/src/lib/library/net-connect.ts` (ship ở S10-SOCIAL-LIB-2) gọi thẳng
  `WNetAddConnection2` với tài khoản người dùng nhập ở giao diện ⇒ tiến trình tự dựng một phiên SMB
  **có danh tính**, không phụ thuộc danh tính của tài khoản chạy dịch vụ.
- Docblock của chính file đó nêu rõ cách cũ ("đổi tài khoản chạy dịch vụ, phải tạo tài khoản trùng
  tên trùng mật khẩu trên cả hai máy, cần Administrator cả hai bên") và vì sao cách mới tránh được.
- Đo trong CSDL PROD (`settings.mediaLibraryRoots`): đang có **1 gốc kho LAN đang dùng thật** —
  `\MINGSEO3\Users\admin\Desktop\Tool ghép video\output_short`, `username=admin`, mật khẩu đã seal.

Đổi `ObjectName` lúc này chỉ còn **thêm** rủi ro, không bớt: mật khẩu nằm trong registry NSSM, phải
cấp "Log on as a service", phải cấp lại ACL cho `data/` · `.secrets/` · `.next/` (thiếu một cái thì
lỗi hiện ra tận màn đăng bài dưới dạng "không lưu được"), và hỏng khi mật khẩu tài khoản đổi.

**Chốt:** giữ `LocalSystem`. Ghi lý do + bằng chứng vào DEVOPS-14 để lần sau không ai mở lại việc này.
`09-*.ps1` giữ nguyên nhánh `-ServiceAccount` (vẫn chạy được nếu tương lai cần) nhưng docblock nói
rõ đây KHÔNG còn là đường khuyến nghị.

## 3. Thi công

### L1 — vá `09-social-media-library.ps1` trước khi cho nó chạm PROD
Script viết 06/08, chưa từng chạy ⇒ chưa có gì chứng minh nó đúng. Ba lỗi phải vá trước:

1. **`robocopy /MOVE` xoá nguồn ngay** — hỏng giữa chừng là mất đường lùi. Đổi sang
   copy → **đối chiếu số file + tổng byte** → chỉ khi khớp mới đổi tên nguồn thành `data.moved-<stamp>`.
   Xoá bản cũ là việc TAY, sau khi nghiệm thu.
2. **`Set-Content -Encoding UTF8` trên PS 5.1 ghi kèm BOM** vào `.env.production`. Dòng đầu file là
   `MEDIAOS_SSO_SECRET=` ⇒ BOM dính vào tên khoá. (dotenv coi `\uFEFF` là whitespace nên *có lẽ*
   thoát, nhưng "có lẽ" không phải thứ đem áp lên PROD.) Ghi bằng `UTF8Encoding($false)`.
3. **`$RepoRoot` suy từ `$PSScriptRoot`** ⇒ chạy bản trong worktree sẽ trỏ vào `apps/fbpost` của
   worktree (không có `.env.production`, không có `data/`). Thêm tham số `-AppDir` để chạy được từ
   cây khác lên đúng thư mục PROD.

Giá trị ghi vào env dùng **gạch xuôi** `D:/MediaOS-Social/data` — `\` trong .env đã từng bị nuốt một
cái và âm thầm trỏ sang ổ C: ([[social-heavy-video-ingest]]).

### L2 — chạy trên PROD + nghiệm thu BẰNG HÀNH VI
`.\09-social-media-library.ps1 -AppDir "C:\dev 2\MediaOS\apps\fbpost" -DataDir "D:\MediaOS-Social\data"`
(không truyền `-ServiceAccount`).

Nghiệm thu **không đọc log**: sau khi dịch vụ chạy lại, upload 1 media qua app rồi kiểm **file mới
xuất hiện dưới `D:\MediaOS-Social\data\uploads`**, và số hàng `media` trong `fbpost.db` **ở ổ D:** tăng.

### L3 — sao lưu `data/` và `.secrets/` TÁCH nhau (`12-social-backup.ps1` — MỚI)
- `data/` → `D:\backup-social\data\fbpost-data-<stamp>.zip`, giữ **7 bản**, xoay vòng.
  SQLite ở chế độ WAL **không copy nóng an toàn** ⇒ dùng `VACUUM INTO` (không cần dừng dịch vụ)
  thay vì `cp` file `.db`.
- KEK → `D:\backup-social\kek\fbpost-kek-<stamp>.bin`, **KHÔNG BAO GIỜ ghi đè**: script từ chối chạy
  nếu file cùng tên đã có. Ghi đè KEK = mọi token Facebook đã mã hoá thành rác **vĩnh viễn**.
- Hai thư mục con tách nhau; retention của `data` KHÔNG được đụng vào `kek`.
- Đăng ký `MediaOS-SocialBackupDaily` 02:30 (lệch 30 phút với `MediaOS-BackupDaily` để hai việc
  không tranh I/O).

### L4 — DEVOPS-14
Thêm/sửa: §2.2 `SOCIAL_DATA_DIR` · §6 Sao lưu (bảng mới, hai đường tách) · mục mới "đường nạp video
nặng" (trần 10MB của Next middleware + trần **100MB của Cloudflare** — vượt là 413 trần trụi, không
phải lỗi tiếng Việt của app) · mục "vì sao KHÔNG đổi sang tài khoản riêng nữa".

## 4. Rủi ro + đường lùi

| Rủi ro | Chặn trước | Đường lùi |
| --- | --- | --- |
| Copy hỏng ⇒ mất 2.8GB media | Đối chiếu số file + tổng byte trước khi đụng nguồn | Nguồn còn nguyên tên `data.moved-<stamp>`: đổi tên lại + gỡ `SOCIAL_DATA_DIR` là về trạng thái cũ |
| Dịch vụ không khởi động lại được | Tự kiểm `/api/library` phải trả **401** (200 = cổng phiên hỏng ⇒ dừng ngay) | Như trên, 2 lệnh |
| Ghi hỏng `.env.production` | Sao lưu `.env.production.bak-<stamp>` trước khi ghi | Chép lại bản bak |
| Gián đoạn người dùng | Cửa sổ ~3–6 phút, owner đã đồng ý làm ngay 18/08 | — |
| Sao lưu KEK bị ghi đè | Script từ chối ghi khi trùng tên | — |

## 5. Nghiệm thu (map thẳng `done_when`)

1. `SOCIAL_DATA_DIR` trỏ ổ D:, dịch vụ đọc đúng kho mới — **chứng minh bằng file media mới nằm dưới D:**, không đọc log. → L2
2. Tài khoản dịch vụ đọc được share LAN — **đổi phạm vi**: LIB-2 đã giải bằng credential trong app; ghi bằng chứng vào DEVOPS-14 thay vì đổi `ObjectName`. → §2 + L4
3. Mật khẩu không vào git, không vào log — không có mật khẩu mới nào phát sinh (bỏ đổi account); nhánh `-ServiceAccount` giữ `Read-Host -AsSecureString` + không log. → L1
4. DEVOPS-14 thêm: đường nạp video nặng · trần 100MB Cloudflare · vì sao không LocalSystem→account. → L4
5. Sao lưu `data/` và `.secrets/` TÁCH nhau. → L3

## 6. An toàn khi chạy song song

Phiên khác (`sess ceeea711`) đang giữ **main worktree** `c:\dev 2\MediaOS` trên nhánh
`auto/S10-AUTH-IPTRUST-1`. WO này làm trong worktree riêng `C:\dev 2\mediaos-s10-social-ops-1`.

Giao nhau về `paths` giữa hai WO: `scripts/windows/**` và `docs/DEVOPS/**`. **Đứt ở cấp FILE**:

| WO | File |
| --- | --- |
| S10-AUTH-IPTRUST-1 | `scripts/windows/10-trust-proxy-probe.ps1` · `docs/DEVOPS/evidence/**` · `.env.example` · `apps/api/**` |
| S10-SOCIAL-OPS-1 (WO này) | `scripts/windows/09-*.ps1` · `scripts/windows/12-social-backup.ps1` · `docs/DEVOPS/DEVOPS-14_*.md` |

Không WO nào chạm file của WO kia ⇒ `git merge-tree` phải sạch. **Không** đụng `harness/backlog.mjs`
(WO kia có nó trong paths) — trạng thái đóng dấu qua `harness/activity.jsonl` (không nằm trong git).
Cả hai đều KHÔNG chạm migration ⇒ không có bẫy trùng số.

---

## 7. Kết quả thi công (18/08/2026)

### 7.1 Đã làm, có số đo

| Việc | Bằng chứng |
| --- | --- |
| Sao lưu ĐẦU TIÊN của fbpost (chạy TRƯỚC khi dời — bản sao lưu chính là lưới an toàn cho thao tác dời) | `D:\backup-social`: snapshot CSDL `integrity_check=ok`, `media=14 contents=11 posts=11` · 14 file / 2.78 GB media · 1 bản KEK |
| Dời kho sang `D:\MediaOS-Social\data` | copy 17 file, **đối chiếu khớp 2.987.223.283 byte**; kho cũ đổi tên `data.moved-20260818-121244` |
| `SOCIAL_DATA_DIR=D:/MediaOS-Social/data` vào `apps/fbpost/.env.production` | ghi không-BOM, có `.bak-<stamp>` |
| Dịch vụ chạy lại, đọc đúng kho mới | `/api/library` → **401** · `D:\...\fbpost.db-shm` mtime **12:15:09** (sau mốc khởi động) · `apps\fbpost\data` **KHÔNG mọc lại** |
| Tác vụ `MediaOS-SocialBackupDaily` 02:30 | chạy thật qua Task Scheduler 3 lần, **`LastTaskResult=0`**; 4 snapshot CSDL, KEK **không** đẻ bản trùng |
| DEVOPS-14 §6 (sao lưu) + §8 (video nặng · 3 trần · vì sao giữ LocalSystem · bẫy PS 5.1) | — |

### 7.2 Hai lỗi THẬT lộ ra khi cho script chạy lần đầu

Cả hai đều nằm trong `09-*.ps1` bản 06/08 — script viết xong rồi **nằm im 12 ngày không ai bấm**.

1. **`catch [Microsoft.PowerShell.Commands.HttpResponseException]`** — kiểu này chỉ có từ PowerShell 7,
   máy PROD chạy **Windows PowerShell 5.1**. Khi PS 5.1 khớp các mệnh đề `catch` nó ném
   `Unable to find type`, **làm nổ cả khối `try/catch`** dù mệnh đề đầu (`System.Net.WebException`)
   vốn khớp đúng. Nghĩa là bước tự-kiểm **không thể chạy được** trên chính cái máy nó phải kiểm.
   `Parser::ParseFile` báo xanh — lỗi chỉ nảy lúc chạy. Vá: đọc thẳng mã trạng thái, không bắt theo kiểu.
2. **Mã thoát** — `robocopy` trả **1** khi "đã chép file" (thành công) và PowerShell lấy `$LASTEXITCODE`
   của lệnh native cuối làm mã thoát cả script ⇒ tác vụ sao lưu sẽ báo `LastTaskResult=1` **mỗi ngày**.
   Vá: `exit 0` tường minh ở cuối `12-social-backup.ps1`.

Ngoài ra bản 06/08 dùng `robocopy /MOVE` (xoá nguồn ngay ⇒ không có đường lùi) và
`Set-Content -Encoding UTF8` (PS 5.1 ghi **kèm BOM** vào `.env.production`, mà dòng đầu file là
`MEDIAOS_SSO_SECRET=`) — cả hai đã đổi trước khi cho chạm PROD.

### 7.3 Va chạm với phiên song song — đã xử

| Va chạm | Xử |
| --- | --- |
| Phiên kia cũng lấy số `11` (`11-trust-proxy-spoof-probe.ps1`) | script này đổi thành **`12-social-backup.ps1`**, tác vụ lịch cập nhật theo |
| `apps/fbpost/data.moved-<stamp>` (**2.8GB**) hiện ra trong `git status` của MỌI nhánh đang checkout — một `git add -A` của bất kỳ phiên nào là đưa cả kho video vào commit | chuyển bản lùi ra **ngoài repo** (`C:\dev 2\fbpost-data.moved-20260818-121244`) + thêm `data.moved-*/` vào `apps/fbpost/.gitignore` để lần sau không tái diễn |

### 7.4 Còn lại (việc của owner)

1. **Nghiệm thu cuối cùng của `done_when` #1** — nạp 1 media qua giao diện Đăng bài, thấy file mới nằm
   dưới `D:\MediaOS-Social\data\uploads`. Cần phiên đăng nhập nên phiên này không tự làm được
   (PROD bật 2FA). Đường ghi đã được chứng minh gián tiếp: `ensureDataDirs()` đã chạy mà không tạo
   lại kho cũ, và `media-service.ts` dùng chung đúng hằng `UPLOADS_DIR`.
2. **Merge PR trước 02:30 ngày 19/08** — tác vụ lịch trỏ tới `C:\dev 2\MediaOS\scripts\windows\12-social-backup.ps1`,
   đường dẫn đó chỉ tồn tại sau khi land. Chưa merge kịp thì tác vụ hỏng đúng một đêm (đã có 4 bản sao lưu).
3. **Xoá bản lùi** `C:\dev 2\fbpost-data.moved-20260818-121244` (2.8GB trên ổ C:) sau khi nghiệm thu xong.
4. **Mang một bản KEK + một snapshot CSDL ra ngoài máy** — cả ba đích sao lưu đang nằm chung ổ D:.
5. FULL gate (`security-reviewer` + `silent-failure-hunter`) **CHƯA CHẠY** — phiên này bị cấm tự gọi agent.
