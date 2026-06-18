# 06-deploy-pages.ps1 — build + deploy 5 SPA lên Cloudflare Pages (web/auth/studio/people/console).
#   Non-interactive: đặt $env:CLOUDFLARE_API_TOKEN (Pages:Edit) + $env:CLOUDFLARE_ACCOUNT_ID. Nếu thiếu → wrangler login.
param(
  [string]$Domain = "funtimemediacorp.com",
  [string[]]$Apps = @("web", "auth", "studio", "people", "console")
)
. "$PSScriptRoot\_lib.ps1"

# wrangler ghi tiến trình + cảnh báo (vd "project đã tồn tại") ra stderr. _lib đặt ErrorActionPreference=Stop
# → PS 5.1 biến MỌI dòng stderr của native exe thành lỗi TERMINATING, làm script chết oan (kể cả khi
# deploy đang chạy bình thường). Hạ xuống Continue; tin cậy $LASTEXITCODE để biết thành/bại thật.
$ErrorActionPreference = "Continue"

Write-Step "06 — Deploy Cloudflare Pages"
Assert-Command pnpm "00-prereqs.ps1"
Assert-Command npx  "Node đi kèm npx (00-prereqs.ps1)"

$api  = "https://api.$Domain/api/v1"
$auth = "https://auth.$Domain"

if (-not $env:CLOUDFLARE_API_TOKEN -or -not $env:CLOUDFLARE_ACCOUNT_ID) {
  Write-Warn "Thiếu CLOUDFLARE_API_TOKEN/ACCOUNT_ID → wrangler login (tương tác)."
  npx wrangler@3 login
}

Push-Location $RepoRoot
try {
  Write-Host "  build shared packages ..."
  pnpm --filter "@mediaos/contracts" --filter "@mediaos/web-core" --filter "@mediaos/ui" build
  if ($LASTEXITCODE -ne 0) { throw "build shared packages thất bại." }

  foreach ($app in $Apps) {
    Write-Step "  app: $app"
    # reset VITE_* để không rò biến giữa các app
    Get-ChildItem Env: | Where-Object { $_.Name -like "VITE_*" } | ForEach-Object { Remove-Item ("Env:" + $_.Name) }

    $env:VITE_API_URL = $api
    switch ($app) {
      "web" {
        $env:VITE_AUTH_APP_URL = $auth
        $env:VITE_STUDIO_URL = "https://studio.$Domain"
        $env:VITE_PEOPLE_URL = "https://people.$Domain"
        $env:VITE_CONSOLE_URL = "https://console.$Domain"
      }
      "auth"    { $env:VITE_DEFAULT_APP_URL = "https://$Domain" }
      "studio"  { $env:VITE_AUTH_APP_URL = $auth; $env:VITE_WORKFLOW_MOCK = "false" }
      "people"  { $env:VITE_AUTH_APP_URL = $auth }
      "console" { $env:VITE_AUTH_APP_URL = $auth }
    }

    Write-Host "    build ..."
    pnpm --filter "@mediaos/$app" build
    if ($LASTEXITCODE -ne 0) { throw "build $app thất bại." }

    # tạo project (bỏ qua nếu đã tồn tại)
    npx wrangler@3 pages project create "$app-mediaos" --production-branch main 2>$null

    Write-Host "    deploy → $app-mediaos ..."
    npx wrangler@3 pages deploy "apps/$app/dist" --project-name "$app-mediaos" --branch main
    if ($LASTEXITCODE -ne 0) { Write-Warn "deploy $app trả mã $LASTEXITCODE." } else { Write-Ok "$app deployed" }
  }
}
finally { Pop-Location }

Write-Ok "06 xong."
Write-Warn "Gắn custom domain mỗi project (1 lần) trên dashboard Pages → Custom domains:"
Write-Host  "  web-mediaos → $Domain (apex) · auth-mediaos → auth.$Domain · studio./people./console.$Domain"
