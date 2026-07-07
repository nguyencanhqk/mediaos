# mediaos.ps1 — CLI tiện ích MediaOS (Windows / PowerShell).
#   Một nguồn sự thật cho: chạy dev · build/rebuild · reset DB · test · deploy domain thật.
#   Gõ qua wrapper:  m <lệnh> [tham số]      (xem m.cmd ở gốc repo)
#   Hoặc:            powershell -ExecutionPolicy Bypass -File mediaos.ps1 <lệnh>
#
# Kiến trúc hiện tại (sau de-media-fy) — 4 app:
#   apps/api  :3100 (NestJS)   apps/auth :5275 (login)
#   apps/app  :5273 (vỏ nghiệp vụ, landing sau login)   apps/console :5278 (quản trị)
# Infra docker: postgres :5432 · pgbouncer :6432 · valkey :6379 · minio :9000/9001
#
# Tương thích Windows PowerShell 5.1 (không ternary / ??). Chỉ WRAP pnpm/turbo/docker + scripts có sẵn.

param(
  [Parameter(Position = 0)][string]$Command = "help",
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

# ── Cấu hình app ────────────────────────────────────────────────────────────
$ApiPort = 3100
$FeApps = @(
  [pscustomobject]@{ Name = "auth";    Port = 5275; Dir = "apps\auth" }
  [pscustomobject]@{ Name = "app";     Port = 5273; Dir = "apps\app" }
  [pscustomobject]@{ Name = "console"; Port = 5278; Dir = "apps\console" }
)
$DefaultDomain = "funtimemediacorp.com"

# ── Log helpers ─────────────────────────────────────────────────────────────
function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  [OK] $m"   -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "  [!]  $m"   -ForegroundColor Yellow }
function Write-Err([string]$m)  { Write-Host "  [X]  $m"   -ForegroundColor Red }

function Exec([scriptblock]$sb, [string]$what) {
  & $sb
  if ($LASTEXITCODE -ne 0) { throw "$what thất bại (exit $LASTEXITCODE)" }
}

# ── Infra / DB helpers ──────────────────────────────────────────────────────
function Test-Port([int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $port); $c.Close(); return $true } catch { return $false }
}

function Wait-Postgres {
  Write-Host "  chờ Postgres sẵn sàng..." -ForegroundColor DarkGray
  for ($i = 0; $i -lt 30; $i++) {
    $null = docker exec mediaos-postgres pg_isready -U mediaos 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Ok "Postgres ready"; return $true }
    Start-Sleep -Seconds 1
  }
  Write-Err "Postgres không sẵn sàng sau 30s"
  return $false
}

function Set-EnvFile([string]$src) {
  $p = Join-Path $Root $src
  if (-not (Test-Path $p)) { Write-Warn "$src không tồn tại — bỏ qua toggle env"; return }
  Copy-Item $p (Join-Path $Root ".env") -Force
  Write-Ok "$src -> .env"
}

function Get-ActiveEnv {
  $envPath = Join-Path $Root ".env"
  if (-not (Test-Path $envPath)) { return "(không có .env)" }
  $cur = Get-Content $envPath -Raw
  foreach ($cand in @("dev", "prod")) {
    $f = Join-Path $Root ".env.$cand"
    if ((Test-Path $f) -and ((Get-Content $f -Raw) -eq $cur)) { return ".env.$cand" }
  }
  return ".env (tuỳ chỉnh)"
}

function Import-DotEnv([string]$path) {
  if (-not (Test-Path $path)) { return }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    Set-Item -Path ("Env:" + $k) -Value $v
  }
}

function Start-DevWindow([string]$name, [string]$dir) {
  $wd = Join-Path $Root $dir
  if (-not (Test-Path $wd)) { Write-Err "không thấy thư mục $dir — bỏ qua $name"; return }
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title MediaOS-$name && pnpm dev" -WorkingDirectory $wd | Out-Null
  Write-Ok "khởi động $name ($dir)"
}

# Cửa sổ `vite preview` — serve BẢN BUILD (dist/) trên cùng cổng dev (preview block trong vite.config.ts).
function Start-PreviewWindow([string]$name, [string]$dir) {
  $wd = Join-Path $Root $dir
  if (-not (Test-Path $wd)) { Write-Err "không thấy thư mục $dir — bỏ qua $name"; return }
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title MediaOS-$name && pnpm preview" -WorkingDirectory $wd | Out-Null
  Write-Ok "khởi động $name ($dir, preview bản build)"
}

# ── Lệnh: hạ tầng + dev ─────────────────────────────────────────────────────
function Invoke-Up   { Write-Step "Infra up"; Exec { docker compose up -d } "docker compose up" }
function Invoke-Down { Write-Step "Infra down"; Exec { docker compose down } "docker compose down" }

function Invoke-Dev {
  Write-Step "Khởi động DEV stack (công ty: demo)"
  Set-EnvFile ".env.dev"
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  Write-Host "  mở cửa sổ riêng cho từng tiến trình..." -ForegroundColor DarkGray
  Start-DevWindow "api" "apps\api"
  foreach ($a in $FeApps) { Start-DevWindow $a.Name $a.Dir }
  Start-Sleep -Seconds 1
  Start-Process "http://localhost:5273" | Out-Null
  Write-Host ""
  Write-Ok "Dev đang chạy. URL:"
  Write-Host "    app     http://localhost:5273   (landing sau login)"
  Write-Host "    auth    http://localhost:5275   (đăng nhập)"
  Write-Host "    console http://localhost:5278   (quản trị)"
  Write-Host "    api     http://localhost:3100/api/v1/health"
  Write-Host ""
  Write-Host "  Login: company=demo  email=admin@demo.local  pass=Admin@12345" -ForegroundColor Magenta
  Write-Warn "Lần đầu chưa có DB: chạy  m reset  (xoá sạch + migrate + seed) trước."
}

# ── Lệnh: build ─────────────────────────────────────────────────────────────
function Invoke-Build   { Write-Step "Build (turbo: contracts + api + 3 app)"; Exec { pnpm build } "pnpm build"; Write-Ok "Build xong" }
function Invoke-Setup   { Write-Step "Setup (pnpm install)"; Exec { pnpm install } "pnpm install"; Write-Ok "Cài deps xong" }
function Invoke-Rebuild { Write-Step "Rebuild (install + build)"; Exec { pnpm install } "pnpm install"; Exec { pnpm build } "pnpm build"; Write-Ok "Rebuild xong" }

function Invoke-Clean {
  Write-Step "Clean (node_modules · dist · .turbo)"
  Write-Warn "Xoá build artifacts — sau đó cần  m setup."
  $targets = @("node_modules", ".turbo")
  Get-ChildItem -Path (Join-Path $Root "apps"), (Join-Path $Root "packages") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    foreach ($t in @("node_modules", "dist", ".turbo")) {
      $p = Join-Path $_.FullName $t
      if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }
  foreach ($t in $targets) {
    $p = Join-Path $Root $t
    if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
  }
  Write-Ok "Đã clean. Tiếp:  m setup"
}

# ── Lệnh: DB ────────────────────────────────────────────────────────────────
function Invoke-Migrate { Write-Step "Migrate DB"; Exec { pnpm db:migrate } "pnpm db:migrate"; Write-Ok "Migrate xong" }

function Invoke-Seed {
  Write-Step "Seed demo (base + full)"
  Push-Location (Join-Path $Root "apps\api")
  try {
    Exec { node demo-seed-base.mjs } "demo-seed-base"
    Exec { node demo-seed-full.mjs } "demo-seed-full"
  } finally { Pop-Location }
  Write-Ok "Seed xong"
}

function Invoke-Roles {
  Write-Step "Sync DB role passwords -> DEV (changeme_*)"
  docker exec mediaos-postgres psql -U mediaos -d postgres -v ON_ERROR_STOP=1 `
    -c "ALTER ROLE mediaos_app WITH LOGIN PASSWORD 'changeme_app_only'" `
    -c "ALTER ROLE mediaos_worker WITH LOGIN PASSWORD 'changeme_worker_only'" `
    -c "ALTER ROLE mediaos WITH LOGIN PASSWORD 'changeme_dev_only'"
  if ($LASTEXITCODE -ne 0) { throw "sync roles thất bại" }
  Write-Ok "Đã đồng bộ role về dev (khớp apps/api/.env)"
}

function Invoke-Reset {
  Write-Step "RESET DB (XOÁ SẠCH volume: postgres · valkey · minio)"
  Write-Warn "Thao tác KHÔNG hoàn tác. Toàn bộ dữ liệu local sẽ mất."
  $ans = Read-Host 'Gõ "RESET" để xác nhận (rỗng = huỷ)'
  if ($ans -ne "RESET") { Write-Warn "Đã huỷ."; return }
  Set-EnvFile ".env.dev"
  Exec { docker compose down -v } "docker compose down -v"
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  Invoke-Migrate
  Import-DotEnv (Join-Path $Root ".env")
  Exec { pnpm db:setup-roles } "pnpm db:setup-roles"
  Invoke-Seed
  Write-Ok "RESET xong: DB sạch + migrate + role + seed"
  Write-Host "  Login: company=demo  email=admin@demo.local  pass=Admin@12345" -ForegroundColor Magenta
}

# ── Lệnh: test / chất lượng ─────────────────────────────────────────────────
function Invoke-Test([string[]]$args) {
  $app = $null
  if ($args.Count -gt 0) { $app = $args[0] }
  $pattern = ""
  if ($args.Count -gt 1) { $pattern = ($args[1..($args.Count - 1)] -join " ") }

  if (-not $app) {
    Write-Warn "Cách dùng:  m test <app> [pattern]   (vd: m test auth, m test api permission)"
    Write-Host  "  app hợp lệ: api · auth · app · console · contracts · ui · web-core"
    return
  }
  $dir = $null
  if (Test-Path (Join-Path $Root "apps\$app\package.json"))     { $dir = "apps\$app" }
  elseif (Test-Path (Join-Path $Root "packages\$app\package.json")) { $dir = "packages\$app" }
  if (-not $dir) { Write-Err "không thấy app/package: $app"; return }

  Write-Step "Test $app ($dir)"
  # vitest TRỰC TIẾP trong thư mục app (turbo nuốt env -> fail giả — xem dev/README.md).
  Push-Location (Join-Path $Root $dir)
  try {
    if ($pattern) { pnpm exec vitest run $pattern } else { pnpm exec vitest run }
  } finally { Pop-Location }
}

function Invoke-Lint      { Write-Step "Lint"; Exec { pnpm lint } "pnpm lint" }
function Invoke-Typecheck { Write-Step "Typecheck"; Exec { pnpm typecheck } "pnpm typecheck" }

function Invoke-Check([string[]]$args) {
  Write-Step "Check (lint + typecheck + test)"
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if ($bash) { & bash harness/check.sh @args; return }
  Write-Warn "Không thấy bash — chạy lint + typecheck (bỏ test). Cài Git Bash để dùng harness/check.sh."
  Exec { pnpm lint } "pnpm lint"
  Exec { pnpm typecheck } "pnpm typecheck"
}

# ── Lệnh: trạng thái ────────────────────────────────────────────────────────
function Invoke-Status {
  Write-Step "Trạng thái MediaOS"
  Write-Host ("  .env đang dùng : " + (Get-ActiveEnv))
  Write-Host ""
  Write-Host "  Docker:" -ForegroundColor DarkGray
  docker compose ps 2>$null
  Write-Host ""
  Write-Host "  Cổng (mở = service đang chạy):" -ForegroundColor DarkGray
  $ports = @(
    @{ n = "api";       p = 3100 }, @{ n = "app";      p = 5273 },
    @{ n = "auth";      p = 5275 }, @{ n = "console";  p = 5278 },
    @{ n = "postgres";  p = 5432 }, @{ n = "pgbouncer"; p = 6432 },
    @{ n = "valkey";    p = 6379 }, @{ n = "minio";    p = 9000 }
  )
  foreach ($x in $ports) {
    $open = Test-Port $x.p
    if ($open) { Write-Host ("    [UP]   {0,-10} :{1}" -f $x.n, $x.p) -ForegroundColor Green }
    else       { Write-Host ("    [down] {0,-10} :{1}" -f $x.n, $x.p) -ForegroundColor DarkGray }
  }
  Write-Host ""
  Write-Host "  API health:" -ForegroundColor DarkGray
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3100/api/v1/health" -UseBasicParsing -TimeoutSec 3
    Write-Ok ("API healthy (HTTP " + $r.StatusCode + ")")
  } catch { Write-Warn "API chưa phản hồi /health (chưa chạy?)" }
}

function Invoke-ProdEnv { Write-Step "Khôi phục .env PROD"; Set-EnvFile ".env.prod"; Write-Warn "Đây là cấu hình PROD (cookie Secure + .domain) — KHÔNG dùng để chạy browser local." }

# ── Lệnh: deploy (Cloudflare Pages + tunnel, Windows) ───────────────────────
function Get-Domain([string[]]$args) {
  if ($args.Count -gt 0 -and $args[0]) { return $args[0] }
  return $DefaultDomain
}

function Invoke-Deploy([string[]]$args) {
  $domain = Get-Domain $args
  Write-Step "DEPLOY ĐẦY ĐỦ -> $domain (Cloudflare Pages + cloudflared tunnel)"
  Write-Warn "Pipeline có bước TƯƠNG TÁC + cần PowerShell Administrator. Đọc docs/ops trước."
  & (Join-Path $Root "scripts\windows\deploy-all.ps1") -Domain $domain
}

function Invoke-DeployFe([string[]]$args) {
  $domain = Get-Domain $args
  Write-Step "DEPLOY FE -> $domain (chỉ 3 SPA: app · auth · console)"
  & (Join-Path $Root "scripts\windows\06-deploy-pages.ps1") -Domain $domain
}

function Invoke-DeployApi {
  Write-Step "DEPLOY API (build + cài/cập nhật Windows service)"
  Write-Warn "Cần PowerShell Administrator (cài service)."
  & (Join-Path $Root "scripts\windows\04-build-install-service.ps1")
}

function Invoke-DeployEnv([string[]]$args) {
  $domain = Get-Domain $args
  Write-Step "Sinh .env PROD cho $domain (secrets ngẫu nhiên + KEK)"
  & (Join-Path $Root "scripts\windows\01-setup-env.ps1") -Domain $domain
}

function Invoke-DeploySeed {
  Write-Step "Seed admin/company (apps/api/seed-admin.mjs) — đọc ADMIN_* từ .env"
  Import-DotEnv (Join-Path $Root ".env")
  Push-Location (Join-Path $Root "apps\api")
  try { node seed-admin.mjs } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "seed-admin thất bại — kiểm tra ADMIN_* trong .env." }
}

# ── DEV-ONLINE (lộ dev stack ra cian-dev.* qua cloudflared, song song prod) ──────────────
# Nạp .env.dev (base) rồi .env.dev-online (override) vào session → cửa sổ con kế thừa.
function Import-DevOnlineEnv {
  $onlineEnv = Join-Path $Root ".env.dev-online"
  if (-not (Test-Path $onlineEnv)) {
    Copy-Item (Join-Path $Root ".env.dev-online.example") $onlineEnv
    Write-Ok "tạo .env.dev-online từ .example (sửa nếu cần)"
  }
  Import-DotEnv (Join-Path $Root ".env.dev")
  Import-DotEnv $onlineEnv
}

# Giải phóng cổng dev-online (API 3200 + Vite 5273/5275/5278) → re-run sạch, khỏi phải đóng cửa sổ tay.
function Stop-DevOnline {
  foreach ($port in @(3200, 5273, 5275, 5278)) {
    $procIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $procIds) {
      if ($procId -and $procId -ne 0) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    }
  }
}

# Rebuild package dùng chung (FE app consume DIST của chúng) → đổi code contracts/ui/web-core mới hiện online.
# turbo cache → nhanh khi không đổi gì.
function Build-SharedPackages {
  Write-Host "  build packages dùng chung (contracts · ui · web-core) ..." -ForegroundColor DarkGray
  Exec {
    pnpm exec turbo run build `
      --filter=@mediaos/contracts --filter=@mediaos/ui --filter=@mediaos/web-core
  } "build shared packages"
}

function Invoke-DevOnlineStop {
  Write-Step "DỪNG dev-online (giải phóng cổng 3200/5273/5275/5278)"
  Stop-DevOnline
  Write-Ok "Đã dừng server dev-online (cửa sổ cmd có thể tự đóng)."
}

function Invoke-DevOnlineDb {
  Write-Step "DEV-ONLINE DB — tạo + migrate + seed mediaos_dev (cô lập khỏi prod)"
  Import-DevOnlineEnv
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  Write-Host "  CREATE DATABASE mediaos_dev (bỏ qua nếu đã có) ..." -ForegroundColor DarkGray
  docker exec mediaos-postgres psql -U mediaos -d postgres -c "CREATE DATABASE mediaos_dev" 2>&1 | Out-Null
  Write-Host "  migrate mediaos_dev (DATABASE_DIRECT_URL từ .env.dev-online) ..." -ForegroundColor DarkGray
  Exec { pnpm db:migrate } "pnpm db:migrate (mediaos_dev)"
  Push-Location (Join-Path $Root "apps\api")
  try {
    $env:SEED_DIRECT_URL = $env:DATABASE_DIRECT_URL
    Exec { node demo-seed-base.mjs } "demo-seed-base"
    Exec { node demo-seed-full.mjs } "demo-seed-full"
  } finally { Pop-Location; Remove-Item Env:SEED_DIRECT_URL -ErrorAction SilentlyContinue }
  Write-Ok "mediaos_dev sẵn sàng (login: demo / admin@demo.local / Admin@12345)"
}

function Invoke-DevOnline {
  Write-Step "DEV-ONLINE — chạy dev stack (API :3200 + 3 SPA) cho cian-dev.*"
  Import-DevOnlineEnv
  Write-Host "  dừng server dev-online cũ (nếu có) → re-run sạch ..." -ForegroundColor DarkGray
  Stop-DevOnline
  Build-SharedPackages
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  Start-DevWindow "api-online" "apps\api"
  # mỗi Vite cần VITE_TUNNEL_HOST riêng (Start-Process chụp env lúc spawn) → set tuần tự.
  $env:VITE_TUNNEL_HOST = "cian-dev.funtimemediacorp.com";         Start-DevWindow "app-online" "apps\app"
  $env:VITE_TUNNEL_HOST = "cian-dev-auth.funtimemediacorp.com";    Start-DevWindow "auth-online" "apps\auth"
  $env:VITE_TUNNEL_HOST = "cian-dev-console.funtimemediacorp.com"; Start-DevWindow "console-online" "apps\console"
  Remove-Item Env:VITE_TUNNEL_HOST -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Ok "Dev-online local đang chạy (API :3200). Online qua cloudflared:"
  Write-Host "    app     https://cian-dev.funtimemediacorp.com"
  Write-Host "    auth    https://cian-dev-auth.funtimemediacorp.com"
  Write-Host "    console https://cian-dev-console.funtimemediacorp.com"
  Write-Host "    api     https://cian-dev-api.funtimemediacorp.com/api/v1/health"
  Write-Host ""
  Write-Host "  Login: demo / admin@demo.local / Admin@12345" -ForegroundColor Magenta
  Write-Warn "Lần đầu: 'm dev-online-db' (tạo mediaos_dev) + 'm dev-online-tunnel' (admin, tạo ingress+DNS)."
  Write-Warn "Cookie domain trùng prod → test bằng trình duyệt/profile KHÁC với prod."
}

function Invoke-DevOnlineTunnel {
  Write-Step "DEV-ONLINE TUNNEL — ingress cian-dev.* (cần Administrator)"
  & (Join-Path $Root "scripts\windows\07-tunnel-dev.ps1")
}

# dev-online-fast — như dev-online nhưng 3 SPA serve BẢN BUILD (vite preview) thay vì dev server.
# Lý do: dev-mode không bundle ⇒ mỗi trang nạp hàng trăm module rời, mỗi request ~200-350ms qua tunnel
# ⇒ chuyển trang/lần vào đầu rất chậm. Bundle ⇒ 2-3 request/trang. Đổi lại KHÔNG có HMR — sửa code FE
# phải chạy lại lệnh này (hoặc dùng `m dev-online` khi cần HMR). API vẫn chạy watch như cũ.
function Invoke-DevOnlineFast {
  Write-Step "DEV-ONLINE FAST — API :3200 (watch) + 3 SPA serve bản build (vite preview)"
  Import-DevOnlineEnv
  Write-Host "  dừng server dev-online cũ (nếu có) → re-run sạch ..." -ForegroundColor DarkGray
  Stop-DevOnline
  Build-SharedPackages
  Write-Host "  build 3 SPA (env VITE_* dev-online bake vào bundle) ..." -ForegroundColor DarkGray
  Exec {
    pnpm exec turbo run build --filter=@mediaos/app --filter=@mediaos/auth --filter=@mediaos/console --force
  } "build 3 SPA"
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  Start-DevWindow "api-online" "apps\api"
  Start-PreviewWindow "app-online" "apps\app"
  Start-PreviewWindow "auth-online" "apps\auth"
  Start-PreviewWindow "console-online" "apps\console"
  Write-Host ""
  Write-Ok "Dev-online FAST đang chạy (bản build — không HMR; sửa FE thì chạy lại 'm dev-online-fast')."
  Write-Host "    app     https://cian-dev.funtimemediacorp.com"
  Write-Host "    auth    https://cian-dev-auth.funtimemediacorp.com"
  Write-Host "    console https://cian-dev-console.funtimemediacorp.com"
  Write-Host ""
  Write-Host "  Login: demo / admin@demo.local / Admin@12345" -ForegroundColor Magenta
}

# ── Dashboard tiến độ (báo cáo dự án, CHẠY ẨN cổng 5180) ─────────────────────
# Server zero-dep đọc LIVE harness/backlog.mjs + git. Khởi động bằng tay qua VBS
# (cửa sổ ẩn, chạy nền) — KHÔNG còn dịch vụ tự khởi động cùng Windows.
function Invoke-Dashboard {
  Write-Step "Dashboard tiến độ — chạy ẨN (http://localhost:5180)"
  if (Test-Port 5180) {
    Write-Ok "Đã chạy sẵn → http://localhost:5180"
    Start-Process "http://localhost:5180" | Out-Null
    return
  }
  $vbs = Join-Path $Root "dev\dashboard-hidden.vbs"
  if (-not (Test-Path $vbs)) { Write-Err "không thấy $vbs"; return }
  Start-Process "wscript.exe" -ArgumentList "`"$vbs`"" | Out-Null
  Start-Sleep -Seconds 2
  if (Test-Port 5180) {
    Write-Ok "Dashboard đang chạy ẩn → http://localhost:5180"
    Start-Process "http://localhost:5180" | Out-Null
  } else {
    Write-Warn "Chưa thấy cổng 5180 mở — chờ thêm vài giây rồi mở http://localhost:5180."
  }
}

function Invoke-DashboardStop {
  Write-Step "Tắt Dashboard (cổng 5180)"
  $procIds = Get-NetTCPConnection -LocalPort 5180 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  if (-not $procIds) { Write-Warn "Dashboard không chạy (cổng 5180 đóng)."; return }
  foreach ($procId in $procIds) {
    if ($procId -and $procId -ne 0) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
  }
  Write-Ok "Đã tắt Dashboard."
}

# ── Help ────────────────────────────────────────────────────────────────────
function Show-Help {
  Write-Host ""
  Write-Host "MediaOS CLI — m <lệnh> [tham số]" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  LOCAL DEV" -ForegroundColor Yellow
  Write-Host "    dev               toggle .env.dev + infra up + chạy api/auth/app/console + mở browser"
  Write-Host "    up | down         bật / tắt infra docker (postgres · pgbouncer · valkey · minio)"
  Write-Host "    status            xem .env đang dùng · docker · cổng · API health"
  Write-Host ""
  Write-Host "  BUILD" -ForegroundColor Yellow
  Write-Host "    setup             pnpm install"
  Write-Host "    build             pnpm build (turbo)"
  Write-Host "    rebuild           pnpm install + pnpm build"
  Write-Host "    clean             xoá node_modules · dist · .turbo (rebuild sạch)"
  Write-Host ""
  Write-Host "  DATABASE" -ForegroundColor Yellow
  Write-Host "    migrate           áp migration (pnpm db:migrate)"
  Write-Host "    seed              seed công ty demo + dữ liệu"
  Write-Host "    roles             sync mật khẩu DB role về dev (khi login báo sai mật khẩu)"
  Write-Host "    reset             [XOÁ SẠCH] down -v + up + migrate + roles + seed"
  Write-Host ""
  Write-Host "  TEST / CHẤT LƯỢNG" -ForegroundColor Yellow
  Write-Host "    test <app> [pat]  vitest 1 app (vd: m test auth)"
  Write-Host "    lint | typecheck  pnpm lint / typecheck"
  Write-Host "    check             harness/check.sh (lint + typecheck + test)"
  Write-Host ""
  Write-Host "  DEPLOY (Cloudflare, Windows — domain mặc định $DefaultDomain)" -ForegroundColor Yellow
  Write-Host "    deploy [domain]     pipeline đầy đủ (cần Administrator)"
  Write-Host "    deploy-fe [domain]  chỉ build + deploy 3 SPA lên Cloudflare Pages"
  Write-Host "    deploy-api          build + cài/cập nhật Windows service API"
  Write-Host "    deploy-env [domain] sinh .env PROD (secrets ngẫu nhiên)"
  Write-Host "    deploy-seed         seed admin/công ty cho prod (đọc ADMIN_* từ .env)"
  Write-Host "    prod-env            khôi phục .env.prod -> .env (KHÔNG chạy browser local)"
  Write-Host ""
  Write-Host "  DEV-ONLINE (lộ dev ra cian-dev.*.funtimemediacorp.com, song song prod)" -ForegroundColor Yellow
  Write-Host "    dev-online          chạy/restart dev stack lộ ra cian-dev.* (tự dừng cũ + rebuild shared)"
  Write-Host "    dev-online-fast     như dev-online nhưng 3 SPA serve BẢN BUILD (nhanh qua tunnel, không HMR)"
  Write-Host "    dev-online-stop     dừng dev-online (giải phóng cổng 3200/5273/5275/5278)"
  Write-Host "    dev-online-db       tạo + migrate + seed DB cô lập mediaos_dev (1 lần)"
  Write-Host "    dev-online-tunnel   tạo ingress cloudflared + DNS cho cian-dev.* (1 lần, Administrator)"
  Write-Host ""
  Write-Host "  DASHBOARD (tiến độ dự án — chạy ẩn cổng 5180)" -ForegroundColor Yellow
  Write-Host "    dashboard         bật dashboard tiến độ (cửa sổ ẩn) -> http://localhost:5180"
  Write-Host "    dashboard-stop    tắt dashboard"
  Write-Host ""
  Write-Host "  menu              menu tương tác (dev/dev.bat gọi cái này)"
  Write-Host ""
}

# ── Menu tương tác (cho dev.bat double-click) ───────────────────────────────
function Show-Menu {
  while ($true) {
    Clear-Host
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "            MediaOS  -  Dev Launcher" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host ("   Repo: " + $Root)
    Write-Host ("   .env: " + (Get-ActiveEnv))
    Write-Host ""
    Write-Host "   [1] Khởi động DEV stack   (api:3100 auth:5275 app:5273 console:5278)"
    Write-Host "   [2] Chỉ bật INFRA docker"
    Write-Host "   [3] TEST một app          (vitest)"
    Write-Host "   [4] SEED dữ liệu demo"
    Write-Host "   [5] REBUILD               (install + build)"
    Write-Host "   [6] RESET DB              [XOÁ SẠCH DATA]"
    Write-Host "   [7] Tắt INFRA             (docker compose down)"
    Write-Host "   [8] Sync DB roles -> dev  (khi login báo sai mật khẩu)"
    Write-Host "   [9] STATUS                (docker · cổng · health)"
    Write-Host "  [10] Khôi phục .env PROD"
    Write-Host ""
    Write-Host "  --- DEV-ONLINE (lộ ra cian-dev.*, song song prod) ---" -ForegroundColor DarkCyan
    Write-Host "  [11] DEV-ONLINE          chạy/restart (tự dừng cũ + rebuild shared)"
    Write-Host "  [12] Dừng dev-online"
    Write-Host "  [13] Dev-online: tạo DB mediaos_dev      (1 lần)"
    Write-Host "  [14] Dev-online: ingress tunnel          (1 lần, Administrator)"
    Write-Host ""
    Write-Host "  --- DASHBOARD tiến độ (chạy ẩn, cổng 5180) ---" -ForegroundColor DarkCyan
    Write-Host "  [15] Bật DASHBOARD (ẩn)    http://localhost:5180"
    Write-Host "  [16] Tắt DASHBOARD"
    Write-Host "   [0] Thoát"
    Write-Host ""
    $choice = Read-Host "Chọn (0-16)"
    switch ($choice) {
      "1"  { Invoke-Dev }
      "2"  { Invoke-Up }
      "3"  { $a = Read-Host "Tên app (api/auth/app/console/...)"; Invoke-Test @($a) }
      "4"  { Invoke-Seed }
      "5"  { Invoke-Rebuild }
      "6"  { Invoke-Reset }
      "7"  { Invoke-Down }
      "8"  { Invoke-Roles }
      "9"  { Invoke-Status }
      "10" { Invoke-ProdEnv }
      "11" { Invoke-DevOnline }
      "12" { Invoke-DevOnlineStop }
      "13" { Invoke-DevOnlineDb }
      "14" { Invoke-DevOnlineTunnel }
      "15" { Invoke-Dashboard }
      "16" { Invoke-DashboardStop }
      "0"  { return }
      default { }
    }
    if ($choice -ne "0") { Write-Host ""; Read-Host "Enter để về menu" | Out-Null }
  }
}

# ── Dispatch ────────────────────────────────────────────────────────────────
switch ($Command.ToLower()) {
  "help"       { Show-Help }
  "--help"     { Show-Help }
  "-h"         { Show-Help }
  "menu"       { Show-Menu }
  "dev"        { Invoke-Dev }
  "up"         { Invoke-Up }
  "down"       { Invoke-Down }
  "stop"       { Invoke-Down }
  "status"     { Invoke-Status }
  "doctor"     { Invoke-Status }
  "setup"      { Invoke-Setup }
  "build"      { Invoke-Build }
  "rebuild"    { Invoke-Rebuild }
  "clean"      { Invoke-Clean }
  "migrate"    { Invoke-Migrate }
  "seed"       { Invoke-Seed }
  "roles"      { Invoke-Roles }
  "reset"      { Invoke-Reset }
  "test"       { Invoke-Test $Rest }
  "lint"       { Invoke-Lint }
  "typecheck"  { Invoke-Typecheck }
  "check"      { Invoke-Check $Rest }
  "prod-env"   { Invoke-ProdEnv }
  "deploy"     { Invoke-Deploy $Rest }
  "deploy-fe"  { Invoke-DeployFe $Rest }
  "deploy-api" { Invoke-DeployApi }
  "deploy-env" { Invoke-DeployEnv $Rest }
  "deploy-seed" { Invoke-DeploySeed }
  "dev-online"        { Invoke-DevOnline }
  "dev-online-fast"   { Invoke-DevOnlineFast }
  "dev-online-stop"   { Invoke-DevOnlineStop }
  "dev-online-db"     { Invoke-DevOnlineDb }
  "dev-online-tunnel" { Invoke-DevOnlineTunnel }
  "dashboard"         { Invoke-Dashboard }
  "dashboard-stop"    { Invoke-DashboardStop }
  default      { Write-Err "Lệnh không hợp lệ: $Command"; Show-Help; exit 1 }
}
