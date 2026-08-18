<#
12-social-backup.ps1 — sao lưu app vệ tinh SOCIAL (fbpost). Chạy hằng ngày qua Task Scheduler.

Trước WO S10-SOCIAL-OPS-1, fbpost KHÔNG nằm trong bất kỳ đường sao lưu nào: `MediaOS-BackupDaily`
(02:00) chỉ gọi `scripts/backup-db.sh` cho Postgres. CSDL SQLite, 2.8GB media và KEK đều là bản DUY NHẤT.

── BA ĐƯỜNG TÁCH NHAU, VÌ BA LÝ DO KHÁC NHAU ──────────────────────────────────
  1. CSDL  → `<BackupRoot>\data\fbpost-<stamp>.db`, giữ `-KeepData` bản, xoay vòng.
     Dùng `VACUUM INTO` chứ KHÔNG copy file: SQLite ở chế độ WAL không an toàn khi copy nóng —
     chép ra một bản `.db` thiếu phần đang nằm trong `-wal` là chép ra bản HỎNG, mà hỏng lặng lẽ:
     file mở được, chỉ thiếu dữ liệu mới nhất. `VACUUM INTO` gộp cả WAL và cho bản nhất quán, KHÔNG
     cần dừng dịch vụ.
  2. Media → `<BackupRoot>\data\uploads\`, mirror CỘNG DỒN (không bao giờ xoá ở đích).
     KHÔNG nén: 2.8GB video đã nén sẵn, zip lại mỗi ngày chỉ tốn giờ và chỗ mà không được gì.
     KHÔNG dùng `/MIR`: xoá nhầm ở nguồn sẽ lan sang bản sao lưu — đúng thứ mà sao lưu phải chặn.
  3. KEK   → `<BackupRoot>\kek\fbpost-kek-<stamp>.bin`, ĐÁNH PHIÊN BẢN, KHÔNG BAO GIỜ ghi đè.
     Ghi đè KEK = mọi token Facebook đã mã hoá thành rác VĨNH VIỄN (không có đường khôi phục).
     Script TỪ CHỐI ghi nếu file cùng tên đã có, và bỏ qua nếu nội dung trùng bản mới nhất
     (KEK gần như không đổi — không việc gì phải đẻ 365 bản giống hệt nhau mỗi năm).
     Retention của `data` KHÔNG được đụng tới `kek`: hai vòng đời khác hẳn nhau.

── Bản sao lưu không kiểm tra được thì không phải bản sao lưu ──────────────────
Sau khi tạo, CSDL snapshot bị `PRAGMA integrity_check` + đếm hàng `media`/`contents`. Không qua ⇒
script thoát mã 1 (Task Scheduler ghi LastTaskResult ≠ 0) và GIỮ NGUYÊN các bản cũ.

Ví dụ:
  .\12-social-backup.ps1
  .\12-social-backup.ps1 -AppDir "C:\dev 2\MediaOS\apps\fbpost" -BackupRoot "D:\backup-social"
#>
param(
  [string]$AppDir = "",
  # Để trống = đọc SOCIAL_DATA_DIR trong .env.production (rơi về <AppDir>\data nếu chưa đặt).
  [string]$DataDir = "",
  [string]$BackupRoot = "D:\backup-social",
  [int]$KeepData = 7
)

$ErrorActionPreference = "Stop"
if ($AppDir -eq "") {
  $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $AppDir = Join-Path $RepoRoot "apps\fbpost"
}
$EnvFile = Join-Path $AppDir ".env.production"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn2($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

if (-not (Test-Path $EnvFile)) { throw "Không thấy $EnvFile — sai -AppDir?" }

# ── 0. Xác định kho dữ liệu ────────────────────────────────────────────────────
if ($DataDir -eq "") {
  $line = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8) | Where-Object { $_ -match '^\s*SOCIAL_DATA_DIR\s*=' } | Select-Object -Last 1
  if ($line) {
    $DataDir = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
  } else {
    # Giống hệt paths.ts: không đặt env thì kho nằm ngay dưới thư mục làm việc của dịch vụ.
    $DataDir = Join-Path $AppDir "data"
    Write-Warn2 "SOCIAL_DATA_DIR chưa đặt — dùng $DataDir (kho vẫn ở ổ C:)."
  }
}
$DataDir = $DataDir -replace '/', '\'
if (-not (Test-Path $DataDir)) { throw "Không thấy kho dữ liệu $DataDir." }

$DbPath = Join-Path $DataDir "fbpost.db"
$UploadsDir = Join-Path $DataDir "uploads"
$KekPath = Join-Path $AppDir ".secrets\fbpost-kek.bin"

$DataBackupDir = Join-Path $BackupRoot "data"
$UploadsBackupDir = Join-Path $DataBackupDir "uploads"
$KekBackupDir = Join-Path $BackupRoot "kek"
foreach ($d in @($DataBackupDir, $UploadsBackupDir, $KekBackupDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# ── 1. CSDL: VACUUM INTO + kiểm tra bản vừa tạo ────────────────────────────────
Write-Step "CSDL: $DbPath"
if (-not (Test-Path $DbPath)) { throw "Không thấy $DbPath." }

$snapshot = Join-Path $DataBackupDir "fbpost-$Stamp.db"
# Chạy qua Node vì `node:sqlite` là đúng thư viện mà app dùng — không cần cài sqlite3.exe rời.
# Viết ra file tạm thay vì `node -e`: chuỗi JS lồng trong PowerShell là nguồn lỗi trích dẫn kinh điển.
$helper = Join-Path $env:TEMP "social-backup-$Stamp.cjs"
$js = @'
const { DatabaseSync } = require("node:sqlite");
const [src, dst] = process.argv.slice(2);
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
db.close();

const snap = new DatabaseSync(dst, { readOnly: true });
const integrity = snap.prepare("PRAGMA integrity_check").get();
const verdict = Object.values(integrity)[0];
if (verdict !== "ok") {
  console.error("INTEGRITY_FAIL " + verdict);
  process.exit(1);
}
const media = snap.prepare("select count(*) c from media").get().c;
const contents = snap.prepare("select count(*) c from contents").get().c;
const posts = snap.prepare("select count(*) c from posts").get().c;
snap.close();
console.log(`OK media=${media} contents=${contents} posts=${posts}`);
'@
[System.IO.File]::WriteAllText($helper, $js, (New-Object System.Text.UTF8Encoding($false)))
try {
  # KHÔNG dùng 2>&1: PS 5.1 biến stderr của exe thành lỗi terminating dù lệnh đã xong.
  $out = & node $helper $DbPath $snapshot
  if ($LASTEXITCODE -ne 0) { throw "Snapshot CSDL hỏng hoặc không tạo được (node mã $LASTEXITCODE): $out" }
} finally { Remove-Item -LiteralPath $helper -Force -ErrorAction SilentlyContinue }

$snapSize = (Get-Item -LiteralPath $snapshot).Length
Write-Ok "snapshot $([math]::Round($snapSize/1KB,1)) KB — $out"

# Xoay vòng: chỉ đụng file khớp ĐÚNG khuôn tên của mình. Một glob rộng tay ở thư mục sao lưu là
# cách nhanh nhất để xoá mất thứ khác đang gửi nhờ.
$olds = @(Get-ChildItem -LiteralPath $DataBackupDir -File -Filter "fbpost-*.db" |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip $KeepData)
foreach ($o in $olds) { Remove-Item -LiteralPath $o.FullName -Force; Write-Host "  gỡ bản cũ: $($o.Name)" }
Write-Ok "giữ $KeepData bản CSDL gần nhất (gỡ $($olds.Count))"

# ── 2. Media: mirror cộng dồn ──────────────────────────────────────────────────
Write-Step "Media: $UploadsDir"
if (Test-Path $UploadsDir) {
  # /E thư mục con · /XO bỏ qua file đích đã mới hơn · KHÔNG /MIR và KHÔNG /PURGE (không xoá ở đích).
  robocopy $UploadsDir $UploadsBackupDir /E /XO /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy media thất bại (mã $LASTEXITCODE)." }
  $srcN = @(Get-ChildItem -LiteralPath $UploadsDir -Recurse -File -Force).Count
  $dstFiles = @(Get-ChildItem -LiteralPath $UploadsBackupDir -Recurse -File -Force)
  $dstBytes = [int64](($dstFiles | Measure-Object -Property Length -Sum).Sum)
  if ($dstFiles.Count -lt $srcN) { throw "Sao lưu media THIẾU: nguồn $srcN file, đích $($dstFiles.Count)." }
  Write-Ok "$($dstFiles.Count) file / $([math]::Round($dstBytes/1GB,2)) GB ở đích (nguồn $srcN)"
} else {
  Write-Warn2 "chưa có $UploadsDir — bỏ qua."
}

# ── 3. KEK: đánh phiên bản, không ghi đè ───────────────────────────────────────
Write-Step "KEK: $KekPath"
if (-not (Test-Path $KekPath)) {
  throw "KHÔNG thấy KEK ở $KekPath — mọi token Facebook đã mã hoá phụ thuộc file này. Dừng lại và tìm cho ra."
}
$kekHash = (Get-FileHash -LiteralPath $KekPath -Algorithm SHA256).Hash
$latestKek = @(Get-ChildItem -LiteralPath $KekBackupDir -File -Filter "fbpost-kek-*.bin" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1)
if ($latestKek.Count -gt 0 -and (Get-FileHash -LiteralPath $latestKek[0].FullName -Algorithm SHA256).Hash -eq $kekHash) {
  Write-Ok "KEK không đổi so với $($latestKek[0].Name) — không đẻ bản trùng"
} else {
  $kekDst = Join-Path $KekBackupDir "fbpost-kek-$Stamp.bin"
  if (Test-Path $kekDst) { throw "$kekDst đã tồn tại — TỪ CHỐI ghi đè KEK." }
  Copy-Item -LiteralPath $KekPath -Destination $kekDst
  if ((Get-FileHash -LiteralPath $kekDst -Algorithm SHA256).Hash -ne $kekHash) {
    Remove-Item -LiteralPath $kekDst -Force
    throw "Bản sao KEK lệch hash so với nguồn — đã gỡ bản hỏng."
  }
  Write-Ok "KEK mới: $(Split-Path -Leaf $kekDst) (tổng $($latestKek.Count + 1) bản, KHÔNG xoay vòng)"
}

Write-Step "XONG"
Write-Host "  CSDL   -> $DataBackupDir\fbpost-$Stamp.db" -ForegroundColor Cyan
Write-Host "  Media  -> $UploadsBackupDir (cong don)" -ForegroundColor Cyan
Write-Host "  KEK    -> $KekBackupDir (danh phien ban)" -ForegroundColor Cyan
Write-Host "  LUU Y: ca ba deu nam tren CUNG mot may. Hong o D: la mat ca ba." -ForegroundColor Yellow
Write-Host "         Dinh ky mang mot ban KEK + mot snapshot CSDL ra ngoai may (USB/OneDrive)." -ForegroundColor Yellow

# `exit 0` TƯỜNG MINH: robocopy trả mã 1 khi "đã chép file" (thành công), và PowerShell lấy
# $LASTEXITCODE của lệnh native cuối cùng làm mã thoát của cả script. Thiếu dòng này thì Task
# Scheduler ghi LastTaskResult=1 mỗi ngày — báo động giả hằng ngày là cách nhanh nhất để người
# vận hành học cách phớt lờ báo động thật. Lỗi thật vẫn thoát khác 0 qua `throw` (ErrorAction Stop).
exit 0
