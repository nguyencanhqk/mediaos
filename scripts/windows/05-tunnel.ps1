# 05-tunnel.ps1 — Cloudflare Tunnel cho api.<domain> → localhost:3100, cài làm Windows service. CẦN Administrator.
#   Có bước TƯƠNG TÁC: cloudflared tunnel login (mở trình duyệt chọn zone).
param(
  [string]$Domain = "funtimemediacorp.com",
  [string]$TunnelName = "mediaos-api"
)
. "$PSScriptRoot\_lib.ps1"

# cloudflared ghi cảnh báo (vd "version outdated") ra stderr. _lib đặt ErrorActionPreference=Stop →
# PS 5.1 biến MỌI dòng stderr của native exe thành lỗi TERMINATING, làm script chết oan (dù chỉ là warn).
# Hạ xuống Continue cho riêng script này; tin cậy exit code + kiểm tra tunnel id thay vì stderr.
$ErrorActionPreference = "Continue"

Write-Step "05 — Cloudflare Tunnel ($TunnelName → api.$Domain)"
Assert-Admin
Assert-Command cloudflared "winget install Cloudflare.cloudflared (00-prereqs.ps1)"

$userCf = Join-Path $env:USERPROFILE ".cloudflared"
$sysCf  = "C:\Windows\System32\config\systemprofile\.cloudflared"

# 1) login (nếu chưa có cert.pem)
if (-not (Test-Path (Join-Path $userCf "cert.pem"))) {
  Write-Warn "Mở trình duyệt — chọn zone $Domain để uỷ quyền cloudflared ..."
  cloudflared tunnel login
}

# 2) tạo tunnel nếu chưa có
$tid = $null
$list = (cloudflared tunnel list --output json 2>$null | ConvertFrom-Json)
if ($list) { $tid = ($list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1).id }
if (-not $tid) {
  Write-Host "  tạo tunnel $TunnelName ..."
  cloudflared tunnel create $TunnelName 2>$null | Out-Null
  $list = (cloudflared tunnel list --output json 2>$null | ConvertFrom-Json)
  $tid = ($list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1).id
}
if (-not $tid) { throw "Không lấy được tunnel id." }
Write-Ok "Tunnel id = $tid"

# 3) route DNS
cloudflared tunnel route dns $TunnelName "api.$Domain" 2>$null
Write-Ok "DNS api.$Domain → tunnel (nếu record đã tồn tại, cloudflared bỏ qua — không sao)"

# 4) config.yml (credentials trỏ tới system profile — nơi service LocalSystem đọc)
$credSys = Join-Path $sysCf "$tid.json"
$config = @"
tunnel: $tid
credentials-file: $credSys
ingress:
  - hostname: api.$Domain
    service: http://localhost:3100
  - service: http_status:404
"@
Write-TextFile -Path (Join-Path $userCf "config.yml") -Content $config

# 5) copy cert/credentials/config sang system profile cho service
if (-not (Test-Path $sysCf)) { New-Item -ItemType Directory -Force -Path $sysCf | Out-Null }
Copy-Item (Join-Path $userCf "$tid.json")  $sysCf -Force
Copy-Item (Join-Path $userCf "cert.pem")   $sysCf -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $userCf "config.yml") $sysCf -Force
Write-Ok "Copy config → $sysCf"

# 6) cài + chạy service
if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
  Write-Host "  service cloudflared đã có → restart ..."
  Restart-Service cloudflared
} else {
  cloudflared service install
  Start-Service cloudflared
}

Write-Host "  kiểm tra qua edge ..."
$ok = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 4
  try { Invoke-RestMethod "https://api.$Domain/api/v1/health" -TimeoutSec 5 | Out-Null; $ok = $true; break } catch { }
}
if ($ok) { Write-Ok "API reachable: https://api.$Domain/api/v1/health" }
else { Write-Warn "Chưa thấy qua edge — DNS có thể đang lan truyền; xem 'cloudflared tunnel info $TunnelName'." }

Write-Ok "05 xong. Tiếp: 06-deploy-pages.ps1"
