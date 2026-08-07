
<#
09-social-media-library.ps1 — bật KHO VIDEO đọc từ thư mục cho app vệ tinh SOCIAL (fbpost).

Chạy MỘT LẦN sau khi land S10-SOCIAL-LIB-1. CẦN QUYỀN ADMINISTRATOR (dừng/khởi động dịch vụ +
đổi tài khoản chạy dịch vụ).

Làm ba việc, theo đúng thứ tự này:
  1. Dời kho dữ liệu sang ổ D:  — ổ C: chỉ còn ~410GB và còn phải nuôi Postgres/API của PROD;
     video nặng phải nằm ở D: (~1.4TB trống). Dời khi kho còn trống là rẻ nhất.
  2. Đổi tài khoản chạy dịch vụ — LocalSystem KHÔNG mang danh tính ra mạng nên KHÔNG BAO GIỜ đọc
     được \\DESKTOP-KTNA4B6\... dù đường dẫn đúng tuyệt đối. Đây là lý do #1 khiến bước này thất bại.
  3. Khởi động lại + tự kiểm.

⚠ WORKGROUP: hai máy không cùng domain thì tài khoản dùng ở đây PHẢI tồn tại trên CẢ HAI máy với
   CÙNG tên và CÙNG mật khẩu — đó là cách Windows xác thực SMB trong workgroup. Thiếu điều này thì
   mọi thứ nhìn như đã cấu hình đúng mà vẫn "Access denied".

Ví dụ:
  .\09-social-media-library.ps1
  .\09-social-media-library.ps1 -ServiceAccount ".\fmcai"
  .\09-social-media-library.ps1 -DataDir "D:\mediaos-social\data" -SkipMove
#>
param(
  [string]$DataDir = "D:\mediaos-social\data",
  # Để trống = giữ nguyên tài khoản hiện tại. Truyền ".\ten" cho tài khoản cục bộ.
  [string]$ServiceAccount = "",
  [switch]$SkipMove
)

$ErrorActionPreference = "Stop"
$ServiceName = "MediaOS-Social"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppDir = Join-Path $RepoRoot "apps\fbpost"
$EnvFile = Join-Path $AppDir ".env.production"

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn2($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

# ── 0. Điều kiện ────────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Phải chạy bằng Administrator (dừng dịch vụ + đổi tài khoản chạy dịch vụ)." }

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
  $nssm = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"
}
if (-not (Test-Path $nssm)) { throw "Không tìm thấy nssm.exe. Cài bằng: winget install NSSM.NSSM" }
if (-not (Test-Path $EnvFile)) { throw "Không thấy $EnvFile — chạy 04-build-install-service.ps1 trước." }

Write-Step "Dừng dịch vụ $ServiceName"
Stop-Service $ServiceName -Force
# Chờ dừng HẲN: SQLite còn giữ file .db-wal, copy lúc tiến trình chưa thoát là chép ra bản hỏng.
(Get-Service $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
Write-Ok "đã dừng"

# ── 1. Dời kho sang ổ D: ────────────────────────────────────────────────────────
if (-not $SkipMove) {
  Write-Step "Dời kho dữ liệu sang $DataDir"
  $oldData = Join-Path $AppDir "data"

  if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }

  if (Test-Path $oldData) {
    # robocopy /MOVE chép rồi xoá nguồn. Mã thoát < 8 là thành công (1 = đã chép, 3 = chép + thừa).
    # KHÔNG dùng 2>&1: PS 5.1 biến stderr của exe thành lỗi terminating và giết script dù đã xong.
    robocopy $oldData $DataDir /MOVE /E /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy thất bại (mã $LASTEXITCODE) — kho chưa dời, dịch vụ vẫn dừng." }
    Write-Ok "đã dời (gồm fbpost.db + .db-wal + .db-shm + uploads/)"
  } else {
    Write-Warn2 "không thấy $oldData — coi như kho mới, chỉ tạo thư mục."
  }

  # KEK KHÔNG nằm trong data/ (SOCIAL_KEK_PATH = .secrets/fbpost-kek.bin, tương đối theo AppDirectory)
  # nên không dời theo. Ghi đè KEK = mọi token Facebook đã mã hoá thành rác VĨNH VIỄN.
  Write-Warn2 "KEK ở apps\fbpost\.secrets\ — KHÔNG dời, và phải sao lưu TÁCH khỏi data\."
}

# ── 2. Ghi SOCIAL_DATA_DIR vào .env.production ─────────────────────────────────
Write-Step "Cập nhật $EnvFile"
$lines = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)
$key = "SOCIAL_DATA_DIR="
$newLine = "$key$DataDir"
$idx = [Array]::FindIndex($lines, [Predicate[string]] { param($l) $l.StartsWith($key) })
if ($idx -ge 0) { $lines[$idx] = $newLine } else { $lines += @("", "# Kho dữ liệu (S10-SOCIAL-OPS-1) — để ở ổ D: vì video nặng.", $newLine) }
Set-Content -LiteralPath $EnvFile -Value $lines -Encoding UTF8
Write-Ok "SOCIAL_DATA_DIR = $DataDir"

# ── 3. Đổi tài khoản chạy dịch vụ ──────────────────────────────────────────────
if ($ServiceAccount -ne "") {
  Write-Step "Đổi tài khoản chạy dịch vụ sang $ServiceAccount"
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
} else {
  $current = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").StartName
  if ($current -eq "LocalSystem") {
    Write-Warn2 "Dịch vụ vẫn chạy bằng LocalSystem — sẽ KHÔNG đọc được ổ chia sẻ trong LAN."
    Write-Warn2 "Chạy lại với -ServiceAccount `".\<tên tài khoản>`" khi sẵn sàng."
  }
}

# ── 4. Khởi động + tự kiểm ─────────────────────────────────────────────────────
Write-Step "Khởi động lại + tự kiểm"
Start-Service $ServiceName
(Get-Service $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))

$port = 3500
$deadline = (Get-Date).AddSeconds(45)
$ready = $false
while ((Get-Date) -lt $deadline -and -not $ready) {
  try {
    # 401 = route CÓ và cổng phiên ĐANG gác. 200 ở đây mới là chuyện đáng báo động.
    Invoke-WebRequest "http://localhost:$port/api/library" -UseBasicParsing -TimeoutSec 5 | Out-Null
    throw "/api/library trả 200 khi KHÔNG có phiên — cổng phiên hỏng, DỪNG LẠI và báo người phụ trách."
  } catch [System.Net.WebException] {
    $code = [int]$_.Exception.Response.StatusCode
    if ($code -eq 401) { $ready = $true }
    else { Start-Sleep -Seconds 2 }
  } catch [Microsoft.PowerShell.Commands.HttpResponseException] {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) { $ready = $true }
    else { Start-Sleep -Seconds 2 }
  }
}
if (-not $ready) { throw "Sau 45 giây /api/library vẫn chưa trả 401 — xem apps\fbpost\social.err.log." }
Write-Ok "/api/library trả 401 khi chưa đăng nhập — route sống, cổng phiên đang gác"

Write-Step "XONG"
Write-Host @"
  Còn lại (làm trên máy DESKTOP-KTNA4B6, không script từ đây được):
    - Cấp quyền ĐỌC thư mục chia sẻ cho ĐÚNG tài khoản đang chạy dịch vụ.
    - Workgroup: tài khoản đó phải tồn tại trên CẢ HAI máy, cùng tên + cùng mật khẩu.
  Kiểm bằng HÀNH VI, không bằng log: mở app Đăng bài -> Soạn bài -> 'Chọn từ kho video'.
  Thấy 5 thư mục (Đỏ EvE, Hồng, Vàng, XD, XL) là tài khoản dịch vụ đã đọc được share.
"@ -ForegroundColor Cyan
