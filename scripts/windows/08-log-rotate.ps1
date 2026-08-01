# 08-log-rotate.ps1 — S6-OPS-LOGWINDOW-1 · xoay + dọn log NSSM của MediaOS-API.
#
#   Đo 2026-08-01: logs\api.out.log = 688 MB, logs\api.err.log = 2 MB, và service MediaOS-API TẮT
#   hoàn toàn xoay log (AppRotateFiles/Online/Bytes/Seconds đều = 0) ⇒ hai file này CHƯA TỪNG được
#   xoay kể từ ngày cài. Bản vá 24/07 là cắt tay (api.err.log.2026-07-24-truncated-tail) — chứng cứ
#   cho thấy chuyện này đã xảy ra một lần và không có gì chặn nó lặp lại.
#
#   HAI CHẾ ĐỘ, tách theo QUYỀN CẦN CÓ:
#     (mặc định)  DỌN — không cần Administrator. Giữ -Keep bản xoay mới nhất mỗi luồng, cắt bản vượt
#                 -MaxFileMb thành .trimmed.log (giữ ĐẦU + ĐUÔI). Chạy được từ Task Scheduler.
#     -Configure  BẬT XOAY — CẦN Administrator. nssm set 4 tham số rồi RESTART service.
#
#   ⚠️ -Configure làm API PROD gián đoạn ~10-20 giây. NSSM chỉ đọc tham số I/O lúc khởi động, nên
#      không restart thì cấu hình nằm im trong registry. Đổi lại, chính lúc khởi động NSSM xoay ngay
#      file đang vượt ngưỡng — đó cũng là đường xử lý file 688 MB hiện có.
#
#   DÙNG:
#     powershell -File scripts\windows\08-log-rotate.ps1                    # dọn (an toàn, không admin)
#     powershell -File scripts\windows\08-log-rotate.ps1 -DryRun            # xem sẽ làm gì, không đụng file
#     powershell -File scripts\windows\08-log-rotate.ps1 -Configure         # bật xoay + restart (ADMIN)
param(
  [switch]$Configure,
  [switch]$DryRun,
  [int]$RotateMb = 32,
  [int]$Keep = 5,
  [int]$MaxFileMb = 64,
  [string]$ServiceName = "MediaOS-API"
)
. "$PSScriptRoot\_lib.ps1"

$logDir = Join-Path $RepoRoot "logs"
# Hai luồng NSSM ghi ra. Bản xoay được NSSM đặt tên <luồng>-<YYYYMMDDTHHMMSS.mmm>.log.
$streams = @("api.out", "api.err")
# Giữ lại bao nhiêu ở mỗi đầu khi cắt file quá lớn — đủ để thấy sự cố bắt đầu và kết thúc thế nào.
$headBytes = 2MB
$tailBytes = 8MB

function Format-Size([long]$bytes) {
  if ($bytes -ge 1GB) { return "{0:N2} GB" -f ($bytes / 1GB) }
  if ($bytes -ge 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
  return "{0:N0} KB" -f ($bytes / 1KB)
}

function Get-LogTotalBytes {
  $files = Get-ChildItem -Path $logDir -File -Filter "api.*" -ErrorAction SilentlyContinue
  if (-not $files) { return [long]0 }
  return [long](($files | Measure-Object -Property Length -Sum).Sum)
}

# Cắt file quá lớn thành .trimmed.log giữ ĐẦU + ĐUÔI. KHÔNG xoá thẳng: một file log 688 MB gồm 99%
# dòng lặp vẫn còn giá trị điều tra ở hai đầu — sự cố bắt đầu lúc nào, và nó dừng ra sao. Đây đúng
# khuôn bản vá tay 24/07 đã dùng (api.err.log.2026-07-24-truncated-tail).
function Compress-OversizeLog([System.IO.FileInfo]$file) {
  $target = Join-Path $file.DirectoryName ($file.BaseName + ".trimmed.log")
  # Chốt lại số đo TRƯỚC khi xoá — FileInfo cache thuộc tính, đọc .Length sau Remove-Item là trò may rủi.
  $originalName = $file.Name
  $originalSize = [long]$file.Length
  if ($DryRun) {
    Write-Host ("    cat  {0}  ({1}) -> {2}" -f $originalName, (Format-Size $originalSize), (Split-Path -Leaf $target))
    return
  }

  $src = [System.IO.File]::OpenRead($file.FullName)
  try {
    $dst = [System.IO.File]::Create($target)
    try {
      $buf = New-Object byte[] 1MB

      $remaining = $headBytes
      while ($remaining -gt 0) {
        $want = [Math]::Min($buf.Length, $remaining)
        $read = $src.Read($buf, 0, $want)
        if ($read -le 0) { break }
        $dst.Write($buf, 0, $read)
        $remaining -= $read
      }

      $note = [Text.Encoding]::UTF8.GetBytes(
        "`n`n===== 08-log-rotate.ps1: DA CAT PHAN GIUA — goc $originalName = $(Format-Size $originalSize), " +
        "giu $(Format-Size $headBytes) dau + $(Format-Size $tailBytes) duoi =====`n`n")
      $dst.Write($note, 0, $note.Length)

      if ($originalSize -gt ($headBytes + $tailBytes)) {
        $src.Seek($originalSize - $tailBytes, [System.IO.SeekOrigin]::Begin) | Out-Null
        while ($true) {
          $read = $src.Read($buf, 0, $buf.Length)
          if ($read -le 0) { break }
          $dst.Write($buf, 0, $read)
        }
      }
    }
    finally { $dst.Dispose() }
  }
  finally { $src.Dispose() }

  # Giữ nguyên mtime để thứ tự "mới/cũ" của các bản xoay không bị đảo sau khi cắt.
  (Get-Item $target).LastWriteTime = $file.LastWriteTime
  Remove-Item $file.FullName -Force
  Write-Ok ("cat {0}: {1} -> {2}" -f $originalName, (Format-Size $originalSize), (Format-Size (Get-Item $target).Length))
}

function Invoke-Prune {
  foreach ($stream in $streams) {
    # CHỈ bản đã xoay (`api.out-*.log`). File đang được service ghi (`api.out.log`) không khớp mẫu này
    # — không bao giờ đụng vào file đang mở.
    $rotated = @(Get-ChildItem -Path $logDir -File -Filter "$stream-*.log" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending)
    if ($rotated.Count -eq 0) { Write-Host "  $stream : chua co ban xoay nao"; continue }

    Write-Host ("  {0} : {1} ban xoay, tong {2}" -f $stream, $rotated.Count,
      (Format-Size ([long](($rotated | Measure-Object -Property Length -Sum).Sum))))

    # 1) Xoá phần vượt -Keep (cũ nhất trước) — trước khi cắt, để không phí công cắt file sắp xoá.
    if ($rotated.Count -gt $Keep) {
      foreach ($old in $rotated[$Keep..($rotated.Count - 1)]) {
        if ($DryRun) { Write-Host ("    xoa  {0}  ({1})" -f $old.Name, (Format-Size $old.Length)) }
        else {
          Remove-Item $old.FullName -Force
          Write-Ok ("xoa {0} ({1}) — qua {2} ban giu lai" -f $old.Name, (Format-Size $old.Length), $Keep)
        }
      }
      $rotated = $rotated[0..($Keep - 1)]
    }

    # 2) Cắt phần giữa của bản còn lại nếu quá lớn.
    foreach ($f in $rotated) {
      if ($f.Length -gt ($MaxFileMb * 1MB)) { Compress-OversizeLog $f }
    }
  }
}

Write-Step "08 — Xoay & don log ($logDir)"
if (-not (Test-Path $logDir)) { throw "Khong thay thu muc log: $logDir" }
if ($DryRun) { Write-Warn "DryRun — chi in, khong doi gi tren dia" }

$before = Get-LogTotalBytes
Write-Host ("  tong log truoc: {0}" -f (Format-Size $before))
Get-ChildItem -Path $logDir -File | Sort-Object Length -Descending |
  Select-Object -First 8 |
  ForEach-Object { Write-Host ("    {0,-46} {1,10}" -f $_.Name, (Format-Size $_.Length)) }

if ($Configure) {
  Write-Step "Bat xoay tu dong tren service $ServiceName (CAN Administrator)"
  Assert-Admin
  Assert-Command nssm "winget install NSSM.NSSM (00-prereqs.ps1)"
  if (-not (Get-Service $ServiceName -ErrorAction SilentlyContinue)) {
    throw "Khong thay service $ServiceName — chay 04-build-install-service.ps1 truoc."
  }
  Write-Warn "Service se RESTART — API gian doan ~10-20 giay."

  if ($DryRun) {
    Write-Host "    nssm set $ServiceName AppRotateFiles 1 / AppRotateOnline 1 / AppRotateBytes $($RotateMb * 1MB) / AppRotateSeconds 86400"
    Write-Host "    nssm restart $ServiceName"
  }
  else {
    nssm set $ServiceName AppRotateFiles 1     | Out-Null
    nssm set $ServiceName AppRotateOnline 1    | Out-Null
    nssm set $ServiceName AppRotateBytes ($RotateMb * 1MB) | Out-Null
    nssm set $ServiceName AppRotateSeconds 86400 | Out-Null
    Write-Ok "Da dat: xoay khi > $RotateMb MB hoac qua 1 ngay, xoay duoc ca khi dang chay"

    # Restart: NSSM doc tham so I/O luc khoi dong, va cung chinh luc do no xoay file dang vuot nguong.
    nssm restart $ServiceName | Out-Null
    $healthy = $false
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Seconds 3
      try { Invoke-RestMethod "http://localhost:3100/api/v1/health" -TimeoutSec 4 | Out-Null; $healthy = $true; break } catch { }
    }
    if ($healthy) { Write-Ok "API song lai sau restart" }
    else { Write-Err "API CHUA tra health sau restart — xem logs\api.err.log NGAY" }
  }
}
else {
  Write-Host "  (khong -Configure: chi don. Bat xoay tu dong can Administrator — xem RELEASE-11 §6.2)"
}

Write-Step "Don ban xoay (giu $Keep ban/luong, cat ban > $MaxFileMb MB)"
Invoke-Prune

$after = Get-LogTotalBytes
Write-Host ("`n  tong log sau : {0}   (giai phong {1})" -f (Format-Size $after), (Format-Size ($before - $after)))
Write-Ok "08 xong."
