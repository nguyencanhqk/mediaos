<#
09-social-media-library.ps1 — dời kho dữ liệu của app vệ tinh SOCIAL (fbpost) sang ổ D:.

CẦN QUYỀN ADMINISTRATOR (dừng/khởi động dịch vụ).

Làm ba việc, theo đúng thứ tự này:
  1. Dời kho dữ liệu sang ổ D:  — ổ C: còn ~370GB và còn phải nuôi Postgres/API của PROD; video
     nặng phải nằm ở D: (~1.3TB trống).
  2. Ghi `SOCIAL_DATA_DIR` vào `apps/fbpost/.env.production`.
  3. Khởi động lại + tự kiểm BẰNG HÀNH VI (xem "Tự kiểm" bên dưới).

── VỀ TÀI KHOẢN CHẠY DỊCH VỤ (đọc trước khi định đổi) ──────────────────────────
Bản đầu của script này (06/08/2026) coi việc đổi dịch vụ từ `LocalSystem` sang một tài khoản
Windows là BẮT BUỘC, vì `LocalSystem` không mang danh tính ra mạng nên không đọc nổi `\\MAY\share`.

Điều đó KHÔNG CÒN ĐÚNG kể từ S10-SOCIAL-LIB-2: `src/lib/library/net-connect.ts` gọi thẳng
`WNetAddConnection2` với tài khoản người dùng nhập ở giao diện, nên tiến trình tự dựng một phiên
SMB CÓ DANH TÍNH bất kể nó chạy dưới tài khoản nào. Kho LAN trên PROD đang chạy bằng đúng đường đó.

Vì vậy `-ServiceAccount` giữ lại nhưng KHÔNG còn là đường khuyến nghị: đổi nó chỉ thêm rủi ro
(mật khẩu trong registry NSSM · cần "Log on as a service" · phải cấp lại ACL cho data/ .secrets/
.next/ · hỏng khi mật khẩu đổi) mà không giải quyết thêm vấn đề nào. Chi tiết: DEVOPS-14 §8.

── Tự kiểm (chứng cứ, không phải log) ─────────────────────────────────────────
Sau khi khởi động lại, script khẳng định HAI điều — cả hai đều là hành vi quan sát được:
  (a) `fbpost.db-shm` xuất hiện/được ghi lại DƯỚI KHO MỚI sau mốc khởi động  → tiến trình mở đúng
      CSDL ở ổ D:.
  (b) thư mục `apps\fbpost\data` KHÔNG mọc lại  → `ensureDataDirs()` không rơi về `process.cwd()`,
      tức `SOCIAL_DATA_DIR` đã thực sự tới được tiến trình.
Thiếu (b) là dấu hiệu env chưa vào (bẫy `\` bị nuốt trong .env) — kho cũ sẽ âm thầm mọc lại ở ổ C:.

Ví dụ:
  .\09-social-media-library.ps1
  .\09-social-media-library.ps1 -AppDir "C:\dev 2\MediaOS\apps\fbpost"
  .\09-social-media-library.ps1 -DataDir "D:\MediaOS-Social\data" -SkipMove
#>
param(
  [string]$DataDir = "D:\MediaOS-Social\data",
  # Thư mục app trên máy PROD. Để trống = suy từ vị trí script (dùng khi chạy từ chính cây PROD).
  # Truyền tường minh khi chạy bản script nằm ở worktree/artifact khác cây đang phục vụ.
  [string]$AppDir = "",
  # Để trống = giữ nguyên tài khoản hiện tại (khuyến nghị). Truyền ".\ten" cho tài khoản cục bộ.
  [string]$ServiceAccount = "",
  [switch]$SkipMove
)

$ErrorActionPreference = "Stop"
$ServiceName = "MediaOS-Social"
if ($AppDir -eq "") {
  $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $AppDir = Join-Path $RepoRoot "apps\fbpost"
}
$EnvFile = Join-Path $AppDir ".env.production"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn2($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

# ── 0. Điều kiện ────────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Phải chạy bằng Administrator (dừng/khởi động dịch vụ)." }

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
  $nssm = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"
}
if (-not (Test-Path $nssm)) { throw "Không tìm thấy nssm.exe. Cài bằng: winget install NSSM.NSSM" }
if (-not (Test-Path $EnvFile)) { throw "Không thấy $EnvFile — sai -AppDir, hoặc chạy 04-build-install-service.ps1 trước." }

# Kho phải nằm cùng máy với dịch vụ: đường mạng làm SQLite hỏng theo kiểu không sửa được.
if ($DataDir.StartsWith("\\")) { throw "DataDir không được là đường mạng (SQLite trên SMB = hỏng CSDL)." }

$oldData = Join-Path $AppDir "data"
# Chỉ khi kho cũ ĐÃ được dọn sang tên khác thì "thư mục cũ mọc lại" mới là bằng chứng env hỏng.
# Với -SkipMove (hoặc khi vốn chưa có kho cũ) thư mục vẫn nằm đó một cách hợp lệ.
$parkedOldData = $false

Write-Step "Dừng dịch vụ $ServiceName"
Stop-Service $ServiceName -Force
# Chờ dừng HẲN: SQLite còn giữ file .db-wal, copy lúc tiến trình chưa thoát là chép ra bản hỏng.
(Get-Service $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
Write-Ok "đã dừng"

# ── 1. Dời kho sang ổ D: ────────────────────────────────────────────────────────
# COPY rồi ĐỐI CHIẾU rồi mới đổi tên nguồn — KHÔNG dùng `robocopy /MOVE`. /MOVE xoá nguồn ngay khi
# chép xong từng file, nên nếu chép sai/thiếu thì không còn gì để lùi về. 2.8GB media ở đây là bản
# DUY NHẤT (chưa có đường sao lưu nào cho fbpost tới trước WO này).
if (-not $SkipMove) {
  Write-Step "Dời kho dữ liệu sang $DataDir"

  if (Test-Path $oldData) {
    $srcFiles = @(Get-ChildItem -LiteralPath $oldData -Recurse -File -Force)
    $srcCount = $srcFiles.Count
    $srcBytes = [int64](($srcFiles | Measure-Object -Property Length -Sum).Sum)
    Write-Host "  nguồn: $srcCount file, $([math]::Round($srcBytes/1GB,2)) GB"

    $targetDrive = ([System.IO.Path]::GetPathRoot($DataDir)).TrimEnd('\')
    $free = [int64](Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$targetDrive'").FreeSpace
    if ($free -lt ($srcBytes * 1.2)) {
      throw "Ổ $targetDrive chỉ còn $([math]::Round($free/1GB,1))GB, cần >= $([math]::Round($srcBytes*1.2/1GB,1))GB. Dịch vụ vẫn dừng."
    }

    if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }

    # Mã thoát robocopy < 8 là thành công (1 = đã chép, 3 = chép + thừa ở đích).
    # KHÔNG dùng 2>&1: PS 5.1 biến stderr của exe thành lỗi terminating và giết script dù đã xong.
    robocopy $oldData $DataDir /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy thất bại (mã $LASTEXITCODE) — kho CHƯA dời, nguồn còn nguyên, dịch vụ vẫn dừng." }

    $dstFiles = @(Get-ChildItem -LiteralPath $DataDir -Recurse -File -Force)
    $dstCount = $dstFiles.Count
    $dstBytes = [int64](($dstFiles | Measure-Object -Property Length -Sum).Sum)
    if ($dstCount -ne $srcCount -or $dstBytes -ne $srcBytes) {
      throw "Đối chiếu LỆCH: nguồn $srcCount file/$srcBytes byte, đích $dstCount file/$dstBytes byte. Nguồn còn nguyên — KHÔNG đổi env, xử lý tay."
    }
    Write-Ok "đối chiếu khớp: $dstCount file, $dstBytes byte"

    # Đổi tên chứ KHÔNG xoá: đường lùi trong tay người vận hành. Xoá là việc tay, sau nghiệm thu.
    $parked = "data.moved-$Stamp"
    Rename-Item -LiteralPath $oldData -NewName $parked
    $parkedOldData = $true
    Write-Ok "kho cũ đổi tên thành $parked (giữ lại làm đường lùi — xoá TAY sau khi nghiệm thu)"
  } else {
    if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
    Write-Warn2 "không thấy $oldData — coi như kho mới, chỉ tạo thư mục."
  }

  # KEK KHÔNG nằm trong data/ (SOCIAL_KEK_PATH = .secrets/fbpost-kek.bin, tương đối theo AppDirectory)
  # nên không dời theo. Ghi đè KEK = mọi token Facebook đã mã hoá thành rác VĨNH VIỄN.
  Write-Warn2 "KEK ở apps\fbpost\.secrets\ — KHÔNG dời, và sao lưu TÁCH khỏi data\ (12-social-backup.ps1)."
}

# ── 2. Ghi SOCIAL_DATA_DIR vào .env.production ─────────────────────────────────
Write-Step "Cập nhật $EnvFile"
Copy-Item -LiteralPath $EnvFile -Destination "$EnvFile.bak-$Stamp"
$lines = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)
$key = "SOCIAL_DATA_DIR="
# GẠCH XUÔI: `\` trong .env đã từng bị nuốt một cái và âm thầm trỏ sang ổ C: mà không ai thấy.
# Node xử lý `D:/...` trên Windows y hệt `D:\...`.
$envValue = $DataDir -replace '\\', '/'
$newLine = "$key$envValue"
$idx = [Array]::FindIndex($lines, [Predicate[string]] { param($l) $l.StartsWith($key) })
if ($idx -ge 0) { $lines[$idx] = $newLine } else { $lines += @("", "# Kho dữ liệu (S10-SOCIAL-OPS-1) — để ở ổ D: vì video nặng.", $newLine) }
# UTF8Encoding($false) = KHÔNG BOM. `Set-Content -Encoding UTF8` của PS 5.1 ghi KÈM BOM, mà dòng đầu
# file này là MEDIAOS_SSO_SECRET= ⇒ BOM dính vào tên khoá đầu tiên.
[System.IO.File]::WriteAllLines($EnvFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "SOCIAL_DATA_DIR = $envValue"

# ── 3. Đổi tài khoản chạy dịch vụ (KHÔNG khuyến nghị — xem docblock đầu file) ───
if ($ServiceAccount -ne "") {
  Write-Step "Đổi tài khoản chạy dịch vụ sang $ServiceAccount"
  Write-Warn2 "LIB-2 đã giải bài đọc share LAN bằng credential trong app — cân nhắc lại việc này."
  $secure = Read-Host "Mật khẩu cho $ServiceAccount" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  try {
    # Mật khẩu chỉ tồn tại trong biến này và đi thẳng vào nssm — KHÔNG ghi ra log, KHÔNG vào git.
    & $nssm set $ServiceName ObjectName $ServiceAccount $plain | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "nssm set ObjectName trả mã $LASTEXITCODE" }
  } finally { $plain = $null }

  # Tài khoản dịch vụ cần quyền "Log on as a service" — thiếu là dịch vụ không khởi động nổi.
  Write-Warn2 "Nếu dịch vụ không khởi động: cấp quyền 'Log on as a service' cho $ServiceAccount (secpol.msc)."

  # LocalSystem ghi được mọi chỗ trên máy; một tài khoản thường thì KHÔNG. Đổi tài khoản mà quên
  # bước này thì dịch vụ chạy được nhưng không ghi nổi CSDL/kho media — và lỗi hiện ra ở tận màn
  # đăng bài dưới dạng "không lưu được", chẳng ai nghĩ tới quyền thư mục.
  $account = $ServiceAccount -replace '^\.\\', "$env:COMPUTERNAME\"
  foreach ($dir in @($DataDir, (Join-Path $AppDir ".secrets"), (Join-Path $AppDir ".next"))) {
    if (-not (Test-Path $dir)) { continue }
    $acl = Get-Acl -LiteralPath $dir
    $rights = if ($dir -like "*.secrets") { "ReadAndExecute" } else { "Modify" }
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
          $account, $rights, "ContainerInherit,ObjectInherit", "None", "Allow")))
    Set-Acl -LiteralPath $dir -AclObject $acl
    Write-Ok "cấp $rights cho $account trên $dir"
  }
  Write-Ok "đã đổi tài khoản dịch vụ"
}

# ── 4. Khởi động + tự kiểm ─────────────────────────────────────────────────────
Write-Step "Khởi động lại + tự kiểm"
$startedAt = Get-Date
Start-Service $ServiceName
(Get-Service $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))

$port = 3500
$deadline = (Get-Date).AddSeconds(60)
$ready = $false
while ((Get-Date) -lt $deadline -and -not $ready) {
  # KHÔNG bắt theo KIỂU ngoại lệ ở đây. Bản trước viết `catch [System.Net.WebException] {...}
  # catch [Microsoft.PowerShell.Commands.HttpResponseException] {...}` để đỡ cả hai đời PowerShell;
  # nhưng kiểu thứ hai chỉ tồn tại từ PowerShell 7, mà máy PROD chạy Windows PowerShell 5.1. Khi
  # PS 5.1 phải KHỚP các mệnh đề catch, nó không phân giải nổi kiểu đó và ném "Unable to find type"
  # — làm nổ CẢ khối try/catch dù mệnh đề đầu vốn khớp đúng. Parse-check không thấy (lỗi chỉ nảy
  # lúc chạy), nên bản 06/08 nằm im 12 ngày với một tự-kiểm KHÔNG THỂ chạy được trên chính máy nó
  # phải kiểm. Đọc thẳng mã trạng thái, không phụ thuộc kiểu: cùng một câu chạy được ở cả hai đời.
  $status = 0
  try {
    $resp = Invoke-WebRequest "http://localhost:$port/api/library" -UseBasicParsing -TimeoutSec 5
    $status = [int]$resp.StatusCode
  } catch {
    if ($null -ne $_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  }
  # 401 = route CÓ và cổng phiên ĐANG gác. 200 ở đây mới là chuyện đáng báo động.
  if ($status -eq 401) { $ready = $true }
  elseif ($status -eq 200) { throw "/api/library trả 200 khi KHÔNG có phiên — cổng phiên hỏng, DỪNG LẠI và báo người phụ trách." }
  else { Start-Sleep -Seconds 2 }
}
if (-not $ready) { throw "Sau 60 giây /api/library vẫn chưa trả 401 — xem apps\fbpost\social.err.log." }
Write-Ok "/api/library trả 401 khi chưa đăng nhập — route sống, cổng phiên đang gác"

# Ép tiến trình MỞ CSDL: /api/library dừng ở cổng phiên trước khi chạm SQLite, nên chỉ nó thì chưa
# chứng minh được kho nào đang dùng. Trang chủ đọc dữ liệu ⇒ getDb() chạy ⇒ sinh .db-shm.
try { Invoke-WebRequest "http://localhost:$port/" -UseBasicParsing -TimeoutSec 20 | Out-Null } catch { }

# (b) Kho cũ KHÔNG mọc lại: ensureDataDirs() rơi về process.cwd()/data nếu env không tới nơi.
if ($parkedOldData) {
  if (Test-Path $oldData) {
    throw "THẤT BẠI: $oldData mọc lại sau khi khởi động ⇒ SOCIAL_DATA_DIR chưa tới được tiến trình (kiểm tra .env.production). Kho cũ vẫn còn ở data.moved-$Stamp."
  }
  Write-Ok "thư mục cũ $oldData KHÔNG mọc lại — env đã tới được tiến trình"
} else {
  Write-Warn2 "bỏ qua phép thử 'kho cũ mọc lại' (không dời kho ở lần chạy này) — chỉ còn bằng chứng (a)."
}

# (a) CSDL được mở DƯỚI KHO MỚI, sau mốc khởi động.
$shm = Join-Path $DataDir "fbpost.db-shm"
if ((Test-Path $shm) -and ((Get-Item -LiteralPath $shm).LastWriteTime -ge $startedAt)) {
  Write-Ok "CSDL đang mở tại kho MỚI ($shm ghi lúc $((Get-Item -LiteralPath $shm).LastWriteTime.ToString('HH:mm:ss')))"
} else {
  Write-Warn2 "Chưa thấy $shm được ghi sau mốc khởi động — kiểm tra tay trước khi coi là xong."
}

Write-Step "XONG"
Write-Host "  Nghiệm thu cuối phải làm bằng TAY (cần phiên đăng nhập):" -ForegroundColor Cyan
Write-Host "    - Mở app Đăng bài -> Soạn bài -> nạp 1 media -> kiểm file mới nằm dưới $DataDir\uploads" -ForegroundColor Cyan
Write-Host "    - 'Chọn từ kho video' vẫn duyệt được kho LAN (credential do LIB-2 giữ, không liên quan tài khoản dịch vụ)" -ForegroundColor Cyan
if ($parkedOldData) {
  Write-Host "  Sau khi nghiệm thu xong: xoá tay $AppDir\data.moved-$Stamp de lay lai cho tren o C:." -ForegroundColor Cyan
}
Write-Host "  Sao luu: chay 12-social-backup.ps1 (data/ va KEK di hai duong TACH nhau)." -ForegroundColor Cyan
