# 06-deploy-pages.ps1 — build + deploy 3 SPA lên Cloudflare Pages (app/auth/console).
#   app phục vụ ở APEX ($Domain) · auth.$Domain · console.$Domain. (de-media-fy: bỏ web/studio/people cũ.)
#   Non-interactive: đặt $env:CLOUDFLARE_API_TOKEN (Pages:Edit) + $env:CLOUDFLARE_ACCOUNT_ID. Nếu thiếu → wrangler login.
param(
  [string]$Domain = "funtimemediacorp.com",
  # apps/auth dùng company slug CỐ ĐỊNH lúc build (VITE_COMPANY_SLUG ?? 'demo') — form prod KHÔNG có ô nhập.
  # PHẢI khớp company của admin prod (xem ADMIN_COMPANY_SLUG/.env.prod) nếu không login báo sai mật khẩu.
  [string]$CompanySlug = "funtime",
  [string[]]$Apps = @("app", "auth", "console")
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

# Env var User-scope chỉ vào process MỞ SAU khi set — terminal/VS Code mở trước đó không thấy.
# Fallback: process thiếu thì đọc thẳng từ User scope, khỏi phải mở terminal mới.
foreach ($n in "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID") {
  if (-not (Get-Item "Env:$n" -ErrorAction SilentlyContinue)) {
    $v = [Environment]::GetEnvironmentVariable($n, "User")
    if ($v) { Set-Item "Env:$n" $v }
  }
}

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
      # app = vỏ nghiệp vụ ở apex; cần biết auth app để bounce khi mất phiên (main.tsx đọc VITE_AUTH_APP_URL).
      "app"     { $env:VITE_AUTH_APP_URL = $auth }
      # auth = login; sau đăng nhập bounce về app shell ở apex khi `?redirect` vắng (config.ts đọc VITE_DEFAULT_APP_URL).
      # VITE_COMPANY_SLUG: slug công ty cố định (form không có ô nhập) — PHẢI khớp company admin prod.
      "auth"    { $env:VITE_DEFAULT_APP_URL = "https://$Domain"; $env:VITE_COMPANY_SLUG = $CompanySlug }
      # console = quản trị; mất phiên thì về auth (main.tsx đọc VITE_AUTH_APP_URL).
      "console" { $env:VITE_AUTH_APP_URL = $auth }
    }

    Write-Host "    build ..."
    pnpm --filter "@mediaos/$app" build
    if ($LASTEXITCODE -ne 0) { throw "build $app thất bại." }

    # Project name: app → `web-mediaos` (project ĐANG giữ apex funtimemediacorp.com) để domain TỰ cập nhật,
    # KHỎI trỏ lại tay. auth/console deploy vào project cùng tên (đã gắn auth./console. sẵn). de-media-fy:
    # studio/people-mediaos cũ bỏ mặc (parked).
    $projectName = if ($app -eq "app") { "web-mediaos" } else { "$app-mediaos" }

    # tạo project (bỏ qua nếu đã tồn tại)
    npx wrangler@3 pages project create "$projectName" --production-branch main 2>$null

    Write-Host "    deploy → $projectName ..."
    npx wrangler@3 pages deploy "apps/$app/dist" --project-name "$projectName" --branch main
    if ($LASTEXITCODE -ne 0) { Write-Warn "deploy $app trả mã $LASTEXITCODE." } else { Write-Ok "$app ($projectName) deployed" }
  }
}
finally { Pop-Location }

Write-Ok "06 xong. Domain đã gắn sẵn vào project → TỰ cập nhật (KHÔNG cần trỏ lại tay):"
Write-Host  "  $Domain (apex) → web-mediaos · auth.$Domain → auth-mediaos · console.$Domain → console-mediaos"
