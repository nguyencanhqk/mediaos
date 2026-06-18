# 04-build-install-service.ps1 — build NestJS API + cài Windows service (NSSM) auto-start. CẦN Administrator.
#   ⚠️ WorkingDirectory = REPO ROOT (KHÔNG phải apps/api). ENV_FILE_PATHS=[".env","../../.env"] (file
#   trước thắng). Nếu cwd=apps/api thì apps/api/.env (fixture TEST, mật khẩu placeholder) SHADOW root .env
#   prod → API auth DB fail. cwd=root ⇒ root .env prod thắng. (Đã verify foreground 2026-06-18.)
. "$PSScriptRoot\_lib.ps1"

$ServiceName = "MediaOS-API"

Write-Step "04 — Build API + Windows service"
Assert-Admin
Assert-Command pnpm "00-prereqs.ps1"
Assert-Command nssm "winget install NSSM.NSSM (00-prereqs.ps1)"

Push-Location $RepoRoot
try {
  Write-Host "  build contracts + api ..."
  pnpm --filter "@mediaos/contracts" build
  if ($LASTEXITCODE -ne 0) { throw "build contracts thất bại." }
  pnpm --filter "@mediaos/api" build
  if ($LASTEXITCODE -ne 0) { throw "build api thất bại." }
}
finally { Pop-Location }

$nodeExe = (Get-Command node).Source
$apiDir  = Join-Path $RepoRoot "apps\api"
$mainJs  = Join-Path $apiDir "dist\main.js"
$logDir  = Join-Path $RepoRoot "logs"
if (-not (Test-Path $mainJs)) { throw "Không thấy $mainJs (build api lỗi?)." }
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

# Gỡ service cũ nếu có (cài lại sạch).
if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "  service cũ tồn tại → gỡ ..."
  nssm stop $ServiceName | Out-Null
  nssm remove $ServiceName confirm | Out-Null
  Start-Sleep -Seconds 2
}

Write-Host "  cài service $ServiceName ..."
# cwd = REPO ROOT (xem ghi chú đầu file) → root .env prod thắng apps/api/.env fixture.
nssm install $ServiceName "$nodeExe" "apps\api\dist\main.js"
nssm set $ServiceName AppDirectory "$RepoRoot"
nssm set $ServiceName AppEnvironmentExtra NODE_ENV=production
nssm set $ServiceName AppStdout "$logDir\api.out.log"
nssm set $ServiceName AppStderr "$logDir\api.err.log"
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppExit Default Restart
nssm set $ServiceName DisplayName "MediaOS API (NestJS)"
nssm start $ServiceName

Write-Host "  health check ..."
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-RestMethod "http://localhost:3100/api/v1/health" -TimeoutSec 4
    $ok = $true; break
  } catch { }
}
if ($ok) { Write-Ok "API sống tại http://localhost:3100/api/v1/health" }
else { Write-Warn "API chưa trả health — xem $logDir\api.err.log (thường: .env sai / DB chưa migrate / KEK thiếu)." }

Write-Ok "04 xong. Tiếp: 05-tunnel.ps1"
