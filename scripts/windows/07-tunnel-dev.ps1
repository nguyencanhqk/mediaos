# 07-tunnel-dev.ps1 — thêm ingress DEV-ONLINE (cian-dev.*) vào tunnel mediaos-api, GIỮ rule prod api.<domain>.
#   Lộ dev stack local ra internet song song prod. CẦN Administrator (ghi system profile + restart service).
#   Chạy SAU 05-tunnel.ps1 (prod) — tái dùng cùng tunnel + cert. Host 1 cấp *.<domain> nên Universal SSL phủ.
param(
  [string]$Domain = "funtimemediacorp.com",
  [string]$TunnelName = "mediaos-api",
  [string]$DevPrefix = "cian-dev"
)
. "$PSScriptRoot\_lib.ps1"

# cloudflared ghi warn ra stderr → ErrorActionPreference=Stop biến thành lỗi terminating oan. Hạ Continue,
# tin cậy exit code + tunnel id (mirror 05-tunnel.ps1).
$ErrorActionPreference = "Continue"

Write-Step "07 — Tunnel DEV-ONLINE ($DevPrefix.* → dev local)"
Assert-Admin
Assert-Command cloudflared "winget install Cloudflare.cloudflared (00-prereqs.ps1)"

$userCf = Join-Path $env:USERPROFILE ".cloudflared"
$sysCf  = "C:\Windows\System32\config\systemprofile\.cloudflared"

# 1) tunnel id (tunnel prod phải đã tồn tại)
$tid = $null
$list = (cloudflared tunnel list --output json 2>$null | ConvertFrom-Json)
if ($list) { $tid = ($list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1).id }
if (-not $tid) { throw "Không thấy tunnel '$TunnelName' — chạy 05-tunnel.ps1 (prod) trước." }
Write-Ok "Tunnel id = $tid"

# 2) hostnames dev (1 cấp dưới $Domain → Universal SSL *.<domain> phủ TLS)
$hApp     = "$DevPrefix.$Domain"
$hAuth    = "$DevPrefix-auth.$Domain"
$hConsole = "$DevPrefix-console.$Domain"
$hApi     = "$DevPrefix-api.$Domain"

# 3) route DNS (idempotent — record đã có thì cloudflared bỏ qua)
foreach ($h in @($hApi, $hApp, $hAuth, $hConsole)) {
  cloudflared tunnel route dns $TunnelName $h 2>$null
  Write-Ok "DNS $h → tunnel"
}

# 4) config.yml: GIỮ rule prod api.$Domain→3100 + thêm 4 host dev (api 3200, app 5273, auth 5275, console 5278)
$credSys = Join-Path $sysCf "$tid.json"
$config = @"
tunnel: $tid
credentials-file: $credSys
ingress:
  - hostname: api.$Domain
    service: http://localhost:3100
  - hostname: $hApi
    service: http://localhost:3200
  - hostname: $hApp
    service: http://localhost:5273
  - hostname: $hAuth
    service: http://localhost:5275
  - hostname: $hConsole
    service: http://localhost:5278
  - service: http_status:404
"@
Write-TextFile -Path (Join-Path $userCf "config.yml") -Content $config

# 5) copy config sang system profile (service cloudflared chạy LocalSystem đọc ở đó)
if (-not (Test-Path $sysCf)) { New-Item -ItemType Directory -Force -Path $sysCf | Out-Null }
Copy-Item (Join-Path $userCf "config.yml") $sysCf -Force
Write-Ok "Ghi config.yml (prod api + 4 host dev) → user + system profile"

# 6) restart service
if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
  Restart-Service cloudflared
  Write-Ok "restart cloudflared"
} else {
  Write-Warn "service cloudflared chưa cài — chạy 05-tunnel.ps1 (prod) trước."
}

Write-Ok "07 xong. Dev online (chạy 'm dev-online' để bật server local):"
Write-Host "  app     https://$hApp"
Write-Host "  auth    https://$hAuth"
Write-Host "  console https://$hConsole"
Write-Host "  api     https://$hApi/api/v1/health"
