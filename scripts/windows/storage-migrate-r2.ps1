<#
.SYNOPSIS
  Chép object storage sang Cloudflare R2 (hoặc chiều ngược lại khi lùi) bằng rclone — CHỈ CHÉP, KHÔNG BAO GIỜ XOÁ.
  S19-OPS-STORAGEPUBLIC-1 (plan v2 D5, runbook RELEASE-08 / DEVOPS-03 §13.5).

.DESCRIPTION
  -Mode Plan  : bảng số object + tổng byte THEO TỪNG tiền tố cấp 1 của nguồn (tiền tố = id công ty), đánh dấu tiền
                tố đã chọn, rồi `rclone copy --dry-run` trên các tiền tố đã chọn (đếm số object sẽ chép).
  -Mode Copy  : `rclone copy --checksum` từng tiền tố đã chọn (idempotent: chạy lại = chỉ chép object mới/khác).
  -Mode Check : `rclone check` HAI chiều từng tiền tố + so `Content-Type` của mọi object có ở cả hai phía.
                ĐẠT = 0 thiếu ở đích · 0 lệch hash · 0 lỗi · 0 lệch Content-Type. Số object CHỈ có ở đích được in
                để chuyển cho việc dọn (vd tệp tạm đã bị dọn ở nguồn giữa hai lượt chép), không làm KHÔNG ĐẠT.

  Bucket cũ dùng CHUNG cho PROD · dev-online · test ⇒ Copy / Check BẮT BUỘC -Prefix (id công ty PROD lấy từ bảng
  `companies` của DB PROD). Không có chế độ nào chạy trên cả bucket.

  An toàn:
  - Lệnh rclone cho phép là HẰNG ($ALLOWED_RCLONE): copy · check · lsjson · lsf · size. Không sync / move / delete /
    purge / rmdir — script từ chối chạy lệnh ngoài danh sách.
  - Remote dựng bằng biến môi trường của CHÍNH tiến trình này (không ghi file cấu hình rclone; dùng một file cấu
    hình rỗng tạm để không đọc remote cá nhân), xoá biến khi kết thúc.
  - Chỉ đọc 4 khoá S3_ENDPOINT · S3_ACCESS_KEY · S3_SECRET_KEY · S3_BUCKET từ mỗi file cấu hình (file `.env` cũng
    được, các khoá khác bị bỏ qua), kiểm bằng quy tắc dương, KHÔNG in giá trị.
  - Danh sách khoá object (thiếu / lệch / chỉ-có-ở-đích) chỉ ghi vào thư mục tạm ngoài kho; màn hình chỉ in SỐ.

.PARAMETER SourceConf
  File cấu hình nguồn (ngoài kho).
.PARAMETER TargetConf
  File cấu hình đích (ngoài kho).
.PARAMETER Prefix
  Một hoặc nhiều UUID (tiền tố công ty). Copy / Check bắt buộc -Prefix hoặc -PrefixFile.
.PARAMETER PrefixFile
  File mỗi dòng một UUID (vd danh sách id công ty xuất từ DB PROD); dòng trống bị bỏ qua. Gộp với -Prefix.
  Dùng cách này khi gọi qua `powershell -File` (khi đó không truyền được mảng cho -Prefix).
.PARAMETER SourceBucket
  Thay dòng S3_BUCKET của file nguồn (diễn tập trên bucket thử).
.PARAMETER TargetBucket
  Thay dòng S3_BUCKET của file đích (diễn tập trên bucket thử).
.PARAMETER RclonePath
  Đường dẫn rclone.exe; vắng ⇒ tìm trong PATH rồi trong thư mục cài của winget.

.EXAMPLE
  .\storage-migrate-r2.ps1 -SourceConf C:\ops\minio-prod.conf -TargetConf C:\ops\r2-prod.conf -Mode Plan -PrefixFile C:\ops\prod-company-ids.txt
.EXAMPLE
  # Lùi (sau khi đã chuyển): đảo hai file cấu hình
  .\storage-migrate-r2.ps1 -SourceConf C:\ops\r2-prod.conf -TargetConf C:\ops\minio-prod.conf -Mode Copy -PrefixFile C:\ops\prod-company-ids.txt
#>
# PositionalBinding=$false: giá trị thừa (vd `-Prefix a b` qua `powershell -File`) phải báo LỖI, không được lặng lẽ
# rơi vào tham số kế tiếp theo vị trí (đo ở diễn tập 14/10/2026: `b` bị gán vào -RclonePath).
[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(Mandatory = $true)][string]$SourceConf,
  [Parameter(Mandatory = $true)][string]$TargetConf,
  [Parameter(Mandatory = $true)][ValidateSet('Plan', 'Copy', 'Check')][string]$Mode,
  [string[]]$Prefix = @(),
  [string]$PrefixFile = '',
  [string]$SourceBucket = '',
  [string]$TargetBucket = '',
  [string]$RclonePath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$ALLOWED_RCLONE = @('copy', 'check', 'lsjson', 'lsf', 'size')
$UUID_RE = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$BUCKET_RE = '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
$R2_ENDPOINT_RE = '^https://[0-9a-f]{32}(\.eu|\.fedramp)?\.r2\.cloudflarestorage\.com$'
$LOCAL_ENDPOINT_RE = '^http://(localhost|127\.0\.0\.1):[0-9]{2,5}$'
$ACCESS_RE = '^[A-Za-z0-9]{3,128}$'
$SECRET_RE = '^[\x21-\x7E]{8,256}$'
$REMOTE_VARS = @('TYPE', 'PROVIDER', 'ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'REGION', 'FORCE_PATH_STYLE', 'NO_CHECK_BUCKET')

function Read-StorageConf {
  param([string]$Path, [string]$BucketOverride, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "${Label}: không thấy file cấu hình" }
  $v = @{}
  foreach ($raw in [System.IO.File]::ReadAllLines($Path)) {
    if ($raw -match '^\s*(S3_ENDPOINT|S3_ACCESS_KEY|S3_SECRET_KEY|S3_BUCKET)\s*=(.*)$') {
      if (-not $v.ContainsKey($Matches[1])) { $v[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
    }
  }
  if ($BucketOverride) { $v['S3_BUCKET'] = $BucketOverride }
  $bad = @()
  if (-not $v.ContainsKey('S3_ENDPOINT')) { $bad += 'S3_ENDPOINT' } else { $v['S3_ENDPOINT'] = $v['S3_ENDPOINT'].TrimEnd('/') }
  if ($bad.Count -eq 0 -and -not ($v['S3_ENDPOINT'] -cmatch $R2_ENDPOINT_RE -or $v['S3_ENDPOINT'] -cmatch $LOCAL_ENDPOINT_RE)) { $bad += 'S3_ENDPOINT' }
  if (-not ($v.ContainsKey('S3_ACCESS_KEY') -and $v['S3_ACCESS_KEY'] -cmatch $ACCESS_RE)) { $bad += 'S3_ACCESS_KEY' }
  if (-not ($v.ContainsKey('S3_SECRET_KEY') -and $v['S3_SECRET_KEY'] -cmatch $SECRET_RE)) { $bad += 'S3_SECRET_KEY' }
  if (-not ($v.ContainsKey('S3_BUCKET') -and $v['S3_BUCKET'] -cmatch $BUCKET_RE)) { $bad += 'S3_BUCKET' }
  if ($bad.Count -gt 0) { throw "${Label}: thiếu hoặc sai dạng $($bad -join ', ') (không in giá trị)" }
  $isR2 = $v['S3_ENDPOINT'] -cmatch $R2_ENDPOINT_RE
  $kind = 'storage tự host'
  if ($isR2) { $kind = 'R2' }
  return [pscustomobject]@{ Conf = $v; IsR2 = $isR2; Kind = $kind; Bucket = $v['S3_BUCKET'] }
}

function Set-RemoteEnv {
  param([string]$Name, $Store)
  $p = "RCLONE_CONFIG_$Name"
  $provider = 'Minio'
  $region = 'us-east-1'
  if ($Store.IsR2) { $provider = 'Cloudflare'; $region = 'auto' }
  Set-Item -Path "Env:${p}_TYPE" -Value 's3'
  Set-Item -Path "Env:${p}_PROVIDER" -Value $provider
  Set-Item -Path "Env:${p}_ENDPOINT" -Value $Store.Conf['S3_ENDPOINT']
  Set-Item -Path "Env:${p}_ACCESS_KEY_ID" -Value $Store.Conf['S3_ACCESS_KEY']
  Set-Item -Path "Env:${p}_SECRET_ACCESS_KEY" -Value $Store.Conf['S3_SECRET_KEY']
  Set-Item -Path "Env:${p}_REGION" -Value $region
  Set-Item -Path "Env:${p}_FORCE_PATH_STYLE" -Value 'true'
  Set-Item -Path "Env:${p}_NO_CHECK_BUCKET" -Value 'true'
}

function Clear-RemoteEnv {
  foreach ($name in @('SRC', 'DST')) {
    foreach ($suffix in $REMOTE_VARS) { Remove-Item -Path "Env:RCLONE_CONFIG_${name}_$suffix" -ErrorAction SilentlyContinue }
  }
}

function Find-Rclone {
  if ($RclonePath) {
    if (-not (Test-Path -LiteralPath $RclonePath -PathType Leaf)) { throw "không thấy rclone ở -RclonePath" }
    return $RclonePath
  }
  $cmd = Get-Command rclone -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $hit = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Rclone.Rclone_*\rclone-*\rclone.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  throw 'không tìm thấy rclone (cài: winget install Rclone.Rclone, hoặc truyền -RclonePath)'
}

function Invoke-Rclone {
  param([string]$Sub, [string[]]$Rest, [string]$Tag)
  if ($ALLOWED_RCLONE -cnotcontains $Sub) {
    throw "lệnh rclone '$Sub' không nằm trong danh sách cho phép ($($ALLOWED_RCLONE -join ', ')) — script này không bao giờ xoá"
  }
  $out = Join-Path $script:WorkDir "$Tag.out.txt"
  $err = Join-Path $script:WorkDir "$Tag.err.txt"
  $all = @($Sub) + $Rest + @('--config', $script:EmptyConf)
  $quoted = $all | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
  $proc = Start-Process -FilePath $script:Rclone -ArgumentList $quoted -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  return [pscustomobject]@{ Code = $proc.ExitCode; Out = $out; Err = $err }
}

function Get-LineCount {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  return @([System.IO.File]::ReadAllLines($Path) | Where-Object { $_.Trim() -ne '' }).Count
}

function Get-MimeMap {
  param([string]$Remote, [string]$Tag)
  $r = Invoke-Rclone -Sub 'lsjson' -Rest @('-R', '--files-only', $Remote) -Tag $Tag
  if ($r.Code -ne 0) { throw "lsjson $Tag lỗi (exit $($r.Code)) — xem $($r.Err)" }
  # Khoá object phân biệt hoa-thường; `@{}` của PowerShell thì KHÔNG ⇒ dùng Dictionary so Ordinal.
  $map = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::Ordinal)
  $text = [System.IO.File]::ReadAllText($r.Out)
  if ($text.Trim()) {
    # PowerShell 5.1: `ConvertFrom-Json` trả CẢ mảng như MỘT phần tử của pipeline — bọc `@(... | ConvertFrom-Json)`
    # thành mảng-của-mảng và phép so Content-Type thành rỗng (xanh giả, đo ở diễn tập 14/10/2026).
    # Gán vào biến rồi `foreach` thì câu lệnh foreach tự duyệt từng phần tử.
    $parsed = ConvertFrom-Json -InputObject $text
    foreach ($e in $parsed) { $map[[string]$e.Path] = [string]$e.MimeType }
  }
  # HEAD hỏng thì rclone tự đoán kiểu theo đuôi tệp mà lsjson vẫn exit 0 ⇒ kiểu không tin được.
  $metaErr = @([System.IO.File]::ReadAllLines($r.Err) | Where-Object { $_ -match 'Failed to read metadata|ERROR' }).Count
  if ($metaErr -gt 0) { throw "lsjson ${Tag}: $metaErr dòng lỗi đọc metadata — Content-Type không tin được, xem $($r.Err)" }
  return , $map
}

# ── kiểm tham số ──────────────────────────────────────────────────────────────────────────────────────────────
if ($PrefixFile) {
  if (-not (Test-Path -LiteralPath $PrefixFile -PathType Leaf)) { throw '-PrefixFile: không thấy file' }
  $Prefix = @($Prefix) + @([System.IO.File]::ReadAllLines($PrefixFile) | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}
foreach ($p in $Prefix) { if ($p -cnotmatch $UUID_RE) { throw "-Prefix / -PrefixFile chỉ nhận UUID chữ thường (id công ty)" } }
$Prefix = @($Prefix | Select-Object -Unique)
if ($Mode -ne 'Plan' -and $Prefix.Count -eq 0) { throw "-Mode $Mode bắt buộc -Prefix hoặc -PrefixFile (id công ty PROD) — không có chế độ chạy trên cả bucket" }
if ($SourceBucket -and $SourceBucket -cnotmatch $BUCKET_RE) { throw '-SourceBucket sai dạng' }
if ($TargetBucket -and $TargetBucket -cnotmatch $BUCKET_RE) { throw '-TargetBucket sai dạng' }

$src = Read-StorageConf -Path $SourceConf -BucketOverride $SourceBucket -Label 'nguồn'
$dst = Read-StorageConf -Path $TargetConf -BucketOverride $TargetBucket -Label 'đích'
if ($src.Conf['S3_ENDPOINT'] -ceq $dst.Conf['S3_ENDPOINT'] -and $src.Bucket -ceq $dst.Bucket) { throw 'nguồn và đích là CÙNG một bucket' }

$script:Rclone = Find-Rclone
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:WorkDir = Join-Path $env:TEMP "storage-migrate-r2\$stamp-$Mode"
New-Item -ItemType Directory -Force -Path $script:WorkDir | Out-Null
$script:EmptyConf = Join-Path $script:WorkDir 'empty-rclone.conf'
[System.IO.File]::WriteAllText($script:EmptyConf, '')

Write-Host "storage-migrate-r2 · chế độ $Mode · nguồn: $($src.Kind) bucket $($src.Bucket) → đích: $($dst.Kind) bucket $($dst.Bucket)"
Write-Host "thư mục làm việc (danh sách khoá, log rclone — NGOÀI kho): $script:WorkDir"
$failed = $false
try {
  Set-RemoteEnv -Name 'SRC' -Store $src
  Set-RemoteEnv -Name 'DST' -Store $dst

  if ($Mode -eq 'Plan') {
    $dirs = Invoke-Rclone -Sub 'lsf' -Rest @('--dirs-only', "SRC:$($src.Bucket)") -Tag 'plan-dirs'
    if ($dirs.Code -ne 0) { throw "lsf nguồn lỗi (exit $($dirs.Code)) — xem $($dirs.Err)" }
    $rootFiles = Invoke-Rclone -Sub 'lsf' -Rest @('--files-only', "SRC:$($src.Bucket)") -Tag 'plan-root-files'
    if ($rootFiles.Code -ne 0) { throw "lsf nguồn lỗi (exit $($rootFiles.Code)) — xem $($rootFiles.Err)" }
    Write-Host ''
    Write-Host 'tiền tố cấp 1 của nguồn                | object | byte        | chọn'
    $notUuid = 0
    foreach ($line in [System.IO.File]::ReadAllLines($dirs.Out)) {
      $name = $line.Trim().TrimEnd('/')
      if (-not $name) { continue }
      # Tên lấy từ bucket dùng chung ⇒ dữ liệu không tin cậy: chỉ tên đúng dạng UUID mới được ghép vào tham số
      # rclone / tên file làm việc; tên khác chỉ được ĐẾM.
      if ($name -cnotmatch $UUID_RE) { $notUuid++; continue }
      $s = Invoke-Rclone -Sub 'size' -Rest @('--json', "SRC:$($src.Bucket)/$name") -Tag "plan-size-$name"
      if ($s.Code -ne 0) { throw "size $name lỗi (exit $($s.Code)) — xem $($s.Err)" }
      $j = [System.IO.File]::ReadAllText($s.Out) | ConvertFrom-Json
      $mark = ''
      if ($Prefix -ccontains $name) { $mark = '✔' }
      Write-Host ('{0,-38} | {1,6} | {2,11} | {3}' -f $name, $j.count, $j.bytes, $mark)
    }
    Write-Host "tiền tố KHÔNG phải UUID (chỉ đếm, không xử lý): $notUuid"
    Write-Host "object ở gốc bucket (không thuộc tiền tố nào): $(Get-LineCount $rootFiles.Out)"
    foreach ($p in $Prefix) {
      $d = Invoke-Rclone -Sub 'copy' -Rest @('--dry-run', '--checksum', '-v', "SRC:$($src.Bucket)/$p", "DST:$($dst.Bucket)/$p") -Tag "plan-dry-$p"
      if ($d.Code -ne 0) { throw "copy --dry-run $p lỗi (exit $($d.Code)) — xem $($d.Err)" }
      $n = @([System.IO.File]::ReadAllLines($d.Err) | Where-Object { $_ -match 'Skipped copy as --dry-run is set' }).Count
      Write-Host "dry-run $p : sẽ chép $n object"
    }
  }

  if ($Mode -eq 'Copy') {
    $passed = 0
    foreach ($p in $Prefix) {
      $s = Invoke-Rclone -Sub 'size' -Rest @('--json', "SRC:$($src.Bucket)/$p") -Tag "copy-size-$p"
      if ($s.Code -ne 0) { $failed = $true; Write-Host "KHÔNG ĐẠT · size $p · exit $($s.Code) · xem $($s.Err)"; continue }
      $srcCount = ([System.IO.File]::ReadAllText($s.Out) | ConvertFrom-Json).count
      $c = Invoke-Rclone -Sub 'copy' -Rest @('--checksum', '-v', "SRC:$($src.Bucket)/$p", "DST:$($dst.Bucket)/$p") -Tag "copy-$p"
      $lines = [System.IO.File]::ReadAllLines($c.Err)
      $new = @($lines | Where-Object { $_ -match 'Copied \(new\)' }).Count
      $repl = @($lines | Where-Object { $_ -match 'Copied \(replaced existing\)' }).Count
      if ($c.Code -ne 0) { $failed = $true; Write-Host "KHÔNG ĐẠT · copy $p · nguồn $srcCount object · exit $($c.Code) · xem $($c.Err)"; continue }
      $passed++
      Write-Host "ĐẠT · copy $p · nguồn $srcCount object · mới $new · thay $repl"
    }
    Write-Host "TỔNG copy: ĐẠT $passed/$($Prefix.Count) tiền tố — kết luận cuối luôn là -Mode Check"
  }

  if ($Mode -eq 'Check') {
    $passed = 0; $empty = 0
    foreach ($p in $Prefix) {
      $base = Join-Path $script:WorkDir "check-$p"
      $c = Invoke-Rclone -Sub 'check' -Rest @(
        "SRC:$($src.Bucket)/$p", "DST:$($dst.Bucket)/$p",
        '--match', "$base.match.txt",
        '--missing-on-dst', "$base.missing-on-dst.txt", '--missing-on-src', "$base.only-on-dst.txt",
        '--differ', "$base.differ.txt", '--error', "$base.error.txt") -Tag "check-$p"
      $match = Get-LineCount "$base.match.txt"
      $missing = Get-LineCount "$base.missing-on-dst.txt"
      $onlyDst = Get-LineCount "$base.only-on-dst.txt"
      $differ = Get-LineCount "$base.differ.txt"
      $errors = Get-LineCount "$base.error.txt"
      $srcMime = Get-MimeMap -Remote "SRC:$($src.Bucket)/$p" -Tag "mime-src-$p"
      $dstMime = Get-MimeMap -Remote "DST:$($dst.Bucket)/$p" -Tag "mime-dst-$p"
      $absent = @($srcMime.Keys | Where-Object { -not $dstMime.ContainsKey($_) }).Count
      $mimeBad = @($srcMime.Keys | Where-Object { $dstMime.ContainsKey($_) -and $dstMime[$_] -cne $srcMime[$_] }).Count
      if ($srcMime.Count -eq 0 -and $dstMime.Count -eq 0 -and $c.Code -eq 0) {
        # Công ty chưa có tệp nào — hợp lệ, nhưng in RIÊNG để người đọc thấy (và để gõ nhầm tiền tố không đọc thành ĐẠT).
        $empty++
        Write-Host "RỖNG CẢ HAI PHÍA · check $p (công ty chưa có tệp — đối chiếu với bảng của -Mode Plan)"
        continue
      }
      # Quy tắc DƯƠNG: MỌI object của nguồn phải nằm trong danh sách «khớp» của chính lượt rclone check; exit ≠ 0
      # chỉ được chấp nhận khi lý do duy nhất là object chỉ-có-ở-đích. Lỗi liệt kê giữa chừng ⇒ thiếu dòng «khớp».
      $exitOk = ($c.Code -eq 0) -or ($onlyDst -gt 0)
      $ok = ($srcMime.Count -gt 0) -and ($match -eq $srcMime.Count) -and ($absent -eq 0) -and ($missing -eq 0) -and `
        ($differ -eq 0) -and ($errors -eq 0) -and ($mimeBad -eq 0) -and $exitOk
      $label = 'KHÔNG ĐẠT'
      if ($ok) { $label = 'ĐẠT'; $passed++ } else { $failed = $true }
      Write-Host ("{0} · check {1} · nguồn {2} object · đích {3} · khớp {4} · thiếu ở đích {5} · lệch hash {6} · lỗi {7} · lệch Content-Type {8} · chỉ-có-ở-đích {9} (rclone exit {10})" -f `
          $label, $p, $srcMime.Count, $dstMime.Count, $match, [Math]::Max($missing, $absent), $differ, $errors, $mimeBad, $onlyDst, $c.Code)
    }
    Write-Host "TỔNG check: ĐẠT $passed · RỖNG cả hai phía $empty · KHÔNG ĐẠT $($Prefix.Count - $passed - $empty) / $($Prefix.Count) tiền tố"
  }
}
finally {
  Clear-RemoteEnv
}
if ($failed) { exit 1 }
exit 0
