# 00-prereqs.ps1 — cài công cụ cần thiết qua winget. Chạy 1 lần.
#   Docker Desktop · Node LTS · pnpm (corepack) · cloudflared · nssm · wrangler (npm -g).
# Yêu cầu: winget (có sẵn Windows 11). Một số gói cần khởi động lại shell sau khi cài.
. "$PSScriptRoot\_lib.ps1"

Write-Step "00 — Prerequisites (winget)"
Assert-Command winget "Cập nhật 'App Installer' từ Microsoft Store để có winget."

function Install-Winget { param([string]$Id, [string]$Probe)
  if ($Probe -and (Test-Command $Probe)) { Write-Ok "$Id đã có ($Probe)"; return }
  Write-Host "  cài $Id ..."
  winget install --id $Id -e --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) { Write-Warn "winget '$Id' trả mã $LASTEXITCODE (có thể đã cài / cần thủ công)." }
}

Install-Winget "Docker.DockerDesktop" "docker"
Install-Winget "OpenJS.NodeJS.LTS"     "node"
Install-Winget "Cloudflare.cloudflared" "cloudflared"
Install-Winget "NSSM.NSSM"             "nssm"

# pnpm qua corepack (đi kèm Node) — đúng version dự án (11.5.1).
if (Test-Command node) {
  Write-Host "  bật corepack + pnpm 11.5.1 ..."
  corepack enable
  corepack prepare pnpm@11.5.1 --activate
}

# wrangler: dùng qua `npx wrangler@3` (không cần cài global). Cài global nếu muốn:
if (-not (Test-Command wrangler)) { Write-Warn "wrangler dùng qua 'npx wrangler@3' (06-deploy-pages.ps1)." }

Write-Step "Kiểm tra"
foreach ($c in "docker", "node", "pnpm", "cloudflared", "nssm") {
  if (Test-Command $c) { Write-Ok $c } else { Write-Warn "$c CHƯA sẵn — mở shell mới hoặc cài tay." }
}
Write-Warn "Docker Desktop: MỞ app + đợi 'Engine running' trước khi chạy 02-infra-up.ps1 (bật 'Start on login')."
Write-Ok "00 xong."
