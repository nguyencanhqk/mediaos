# 07-tunnel-dev.ps1 — thêm ingress DEV-ONLINE (cian-dev.*) vào tunnel mediaos-api, GIỮ NGUYÊN mọi rule sẵn có
#   (api. prod, tasklive. dashboard, …). Lộ dev stack local ra internet song song prod. CẦN Administrator.
#   Tự DÒ đúng config.yml mà service cloudflared đang đọc (máy này: NSSM → C:\ProgramData\cloudflared\config.yml).
#   Host 1 cấp *.<domain> nên Universal SSL phủ TLS. Chạy SAU 05-tunnel.ps1 (prod) — tái dùng tunnel + cert.
param(
  [string]$Domain = "funtimemediacorp.com",
  [string]$TunnelName = "mediaos-api",
  [string]$DevPrefix = "cian-dev"
)
. "$PSScriptRoot\_lib.ps1"

# cloudflared ghi warn ra stderr → Stop biến thành lỗi terminating oan. Hạ Continue, tin exit code.
$ErrorActionPreference = "Continue"

Write-Step "07 — Tunnel DEV-ONLINE ($DevPrefix.* → dev local)"
Assert-Admin
Assert-Command cloudflared "winget install Cloudflare.cloudflared (00-prereqs.ps1)"

# 1) tunnel id (tunnel prod phải tồn tại)
$tid = $null
$list = (cloudflared tunnel list --output json 2>$null | ConvertFrom-Json)
if ($list) { $tid = ($list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1).id }
if (-not $tid) { throw "Không thấy tunnel '$TunnelName' — chạy 05-tunnel.ps1 (prod) trước." }
Write-Ok "Tunnel id = $tid"

# 2) DÒ config.yml service cloudflared ĐANG đọc. NSSM: `cloudflared --config <path> tunnel run`.
#    Lấy --config từ AppParameters; fallback các vị trí chuẩn (ProgramData → system profile → user profile).
$cfgPath = $null
$svc = Get-CimInstance Win32_Service -Filter "Name='cloudflared'" -ErrorAction SilentlyContinue
if ($svc -and $svc.PathName -match 'nssm') {
  $nssm = ($svc.PathName -split '"') | Where-Object { $_ -match 'nssm.*\.exe$' } | Select-Object -First 1
  if (-not $nssm) { $nssm = ($svc.PathName -split '\s+')[0] }
  $params = & $nssm get cloudflared AppParameters 2>$null
  if ($params -match '--config\s+"?([^"]+config\.yml)') { $cfgPath = $Matches[1].Trim() }
}
if (-not $cfgPath) {
  foreach ($c in @(
      "C:\ProgramData\cloudflared\config.yml",
      "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml",
      (Join-Path $env:USERPROFILE ".cloudflared\config.yml"))) {
    if (Test-Path $c) { $cfgPath = $c; break }
  }
}
if (-not $cfgPath -or -not (Test-Path $cfgPath)) { throw "Không tìm thấy config.yml của cloudflared (chạy 05-tunnel.ps1 trước?)." }
Write-Ok "Config service: $cfgPath"

# 3) hostnames dev (1 cấp → Universal SSL *.<domain> phủ TLS) + route DNS (idempotent)
$hApp     = "$DevPrefix.$Domain"
$hAuth    = "$DevPrefix-auth.$Domain"
$hConsole = "$DevPrefix-console.$Domain"
$hApi     = "$DevPrefix-api.$Domain"
foreach ($h in @($hApi, $hApp, $hAuth, $hConsole)) {
  cloudflared tunnel route dns $TunnelName $h 2>$null
  Write-Ok "DNS $h → tunnel"
}

# 4) CHÈN 4 host dev TRƯỚC catch-all, GIỮ NGUYÊN rule sẵn có. Idempotent (đã có thì bỏ qua).
$cfg = Get-Content $cfgPath -Raw
if ($cfg -match [regex]::Escape($hApi)) {
  Write-Ok "Ingress dev đã có trong config — bỏ qua chèn."
} else {
  $block = @"
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
  Copy-Item $cfgPath "$cfgPath.bak-devonline" -Force -ErrorAction SilentlyContinue
  if ($cfg -match "(?m)^\s*-\s*service:\s*http_status:404\s*$") {
    $new = $cfg -replace "(?m)^\s*-\s*service:\s*http_status:404\s*$", $block.TrimEnd()
  } else {
    $new = $cfg.TrimEnd() + "`n" + $block   # không có catch-all → append
  }
  [System.IO.File]::WriteAllText($cfgPath, $new, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok "Đã chèn ingress dev (GIỮ rule sẵn có) → $cfgPath"
}

# 5) restart service
if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
  Restart-Service cloudflared
  Write-Ok "restart cloudflared"
} else {
  Write-Warn "service cloudflared chưa cài — chạy 05-tunnel.ps1 (prod) trước."
}

Write-Ok "07 xong. Bật server local bằng 'm dev-online'. URL:"
Write-Host "  app     https://$hApp"
Write-Host "  auth    https://$hAuth"
Write-Host "  console https://$hConsole"
Write-Host "  api     https://$hApi/api/v1/health"
