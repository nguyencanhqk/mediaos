# deploy-all.ps1 — orchestrator chạy toàn bộ pipeline deploy Windows theo thứ tự.
#   Ví dụ:  .\scripts\windows\deploy-all.ps1 -Domain funtimemediacorp.com
#   Có bước TƯƠNG TÁC (cloudflared login, wrangler login, seed company) — đừng để chạy hoàn toàn nền.
#   CẦN PowerShell Administrator (04/05 cài Windows service).
param(
  [string]$Domain = "funtimemediacorp.com",
  [string]$CompanySlug = "funtime",
  [string]$AdminEmail = "",
  [switch]$SkipPrereqs,
  [switch]$ForceEnv,
  [switch]$NonInteractive
)
. "$PSScriptRoot\_lib.ps1"

function Pause-Step([string]$msg) {
  if ($NonInteractive) { Write-Warn "(non-interactive) bỏ qua chờ: $msg"; return }
  Read-Host "`n>>> $msg — Enter để tiếp"
}

Write-Step "MediaOS deploy-all — $Domain"
Assert-Admin

if (-not $SkipPrereqs) {
  & "$PSScriptRoot\00-prereqs.ps1"
  Pause-Step "MỞ Docker Desktop, đợi 'Engine running'"
} else { Write-Warn "Bỏ qua 00-prereqs (đã cài)." }

$envArgs = @{ Domain = $Domain; CompanySlug = $CompanySlug }
if ($AdminEmail) { $envArgs.AdminEmail = $AdminEmail }
if ($ForceEnv)   { $envArgs.Force = $true }
& "$PSScriptRoot\01-setup-env.ps1" @envArgs
Write-Warn "ĐÃ in mật khẩu admin ở trên — LƯU LẠI trước khi tiếp."
Pause-Step "Đã lưu mật khẩu admin chưa?"

& "$PSScriptRoot\02-infra-up.ps1"
& "$PSScriptRoot\03-migrate.ps1"

# Seed admin + company (idempotent — đọc ADMIN_* từ .env). Thay bước psql thủ công cũ + bootstrap-lúc-boot (đã gỡ).
Import-DotEnv
Write-Step "Seed admin (apps/api/seed-admin.mjs)"
Push-Location (Join-Path $RepoRoot "apps\api")
try { node seed-admin.mjs } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "seed-admin thất bại — kiểm tra ADMIN_* trong .env." }

& "$PSScriptRoot\04-build-install-service.ps1"

& "$PSScriptRoot\05-tunnel.ps1" -Domain $Domain

Pause-Step "Tạo 3 Pages project (app/auth/console) + custom domain có thể làm ở 06; tiếp tục deploy FE"
& "$PSScriptRoot\06-deploy-pages.ps1" -Domain $Domain

Write-Step "HOÀN TẤT"
Write-Ok "API: https://api.$Domain/api/v1/health"
Write-Ok "Launcher: https://$Domain  (login qua auth.$Domain)"
Write-Warn "Còn làm tay: gắn custom domain mỗi Pages project · SSL/TLS Full(strict)+HSTS · cron backup (guide §5,§9)."
