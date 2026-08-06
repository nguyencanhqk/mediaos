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
$ProdApiService = "MediaOS-API"   # Windows service API PROD (NSSM — 04-build-install-service.ps1)
$ProdLmsService = "MediaOS-LMS"   # Windows service LMS PROD (apps\lms = fmc-app, node server.mjs)
$LmsPort = 3400                   # LMS PROD — tunnel train.<domain> → localhost:3400
# S9-SOCIAL — app vệ tinh fbpost (đăng bài Facebook Page), DECISIONS-08. Cùng khuôn LMS: workspace
# RIÊNG ngoài turbo, build tại chỗ bằng `npm run build` (fbpost dùng npm, KHÔNG pnpm — R3 của ADR).
$ProdSocialService = "MediaOS-Social"
$SocialPort = 3500                # fbpost PROD — tunnel dangfb.<domain> → localhost:3500
$SocialSubdomain = "dangfb"       # https://dangfb.<domain> (owner chốt 06/08/2026)

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

# Chạy 1 tiến trình dev-online ẨN (không cửa sổ) + gộp stdout+stderr vào dev\logs\<name>.log.
# Mẫu WScript.Shell.Run(cmd, window=0 SW_HIDE, wait=$false detached) — giống dev/dashboard-hidden.vbs nhưng
# gọi COM trực tiếp (khỏi cần .vbs riêng). Ẩn mà VẪN debug được nhờ log file (`m dev-online-logs`).
# Dừng: `m dev-online-stop` (kill theo cổng — cmd /c thoát khi tiến trình con chết → không để lại orphan).
function Start-HiddenApp([string]$name, [string]$dir, [string]$innerCmd) {
  $wd = Join-Path $Root $dir
  if (-not (Test-Path $wd)) { Write-Err "không thấy thư mục $dir — bỏ qua $name"; return }
  $logDir = Join-Path $Root "dev\logs"
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $log = Join-Path $logDir "$name.log"
  # cmd /c có ký tự đặc biệt (`>` `&`) ⇒ cmd chỉ bóc cặp nháy NGOÀI cùng, giữ nháy quanh đường dẫn có dấu
  # cách. CurrentDirectory thay cho `cd` (tránh nháy-trong-nháy). `>` ghi đè log mỗi lần chạy (khởi động sạch).
  $cmd = 'cmd /c "' + $innerCmd + ' > "' + $log + '" 2>&1"'
  $sh = New-Object -ComObject WScript.Shell
  $sh.CurrentDirectory = $wd
  $null = $sh.Run($cmd, 0, $false)
  Write-Ok "khởi động $name ($dir, ẨN → log: dev\logs\$name.log)"
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
# Che mật khẩu trong connection string trước khi in ra console/log.
function Get-MaskedUrl([string]$url) {
  if (-not $url) { return "(trong)" }
  return ($url -replace '://([^:/@]+):[^@]*@', '://$1:***@')
}

# S5-DEVOPS-DEPLOYMIG-1 — nạp .env GỐC repo vào session TRƯỚC khi gọi `pnpm db:migrate`.
# VÌ SAO BẮT BUỘC: apps/api/src/db/migrate.ts CHỈ đọc process.env — nó import `loadEnv` từ config/env.schema,
# KHÔNG import config/load-env (file DUY NHẤT nạp .env vào process.env; chỉ main.ts + gen-openapi.ts dùng).
# Thêm nữa `pnpm db:migrate` = `pnpm --filter @mediaos/api db:migrate` nên cwd = apps/api, càng không thấy
# .env gốc ⇒ chết "DATABASE_DIRECT_URL is required" (đo thật 2026-07-24). Import-DotEnv GHI ĐÈ biến sẵn có
# ⇒ đồng thời dọn env dev-online còn sót trong session (không migrate nhầm mediaos_dev).
function Import-MigrateEnv {
  $envPath = Join-Path $Root ".env"
  if (-not (Test-Path $envPath)) {
    Write-Err "Khong co .env o goc repo -> khong biet migrate vao DB nao ('m prod-env' hoac copy .env.example)."
    return $false
  }
  Import-DotEnv $envPath
  if (-not $env:DATABASE_DIRECT_URL) {
    Write-Err ".env goc THIEU DATABASE_DIRECT_URL -> khong migrate duoc."
    return $false
  }
  return $true
}

# Đo tồn đọng migration (journal repo <-> drizzle.__drizzle_migrations). CHỈ ĐỌC — script chạy đúng 1 SELECT.
# Trả object trạng thái, hoặc $null khi KHÔNG đo được (người gọi PHẢI fail-closed: "không biết" ≠ "không tồn đọng").
# Cần Import-MigrateEnv chạy trước (script đọc DATABASE_DIRECT_URL từ env kế thừa).
function Get-MigrationStatus {
  $statusScript = Join-Path $Root "scripts\windows\migration-status.mjs"
  if (-not (Test-Path $statusScript)) { Write-Err "Khong thay scripts\windows\migration-status.mjs"; return $null }
  $out = $null
  try { $out = & node $statusScript --json }
  catch { Write-Err ("khong chay duoc node migration-status: " + $_.Exception.Message); return $null }
  $raw = ($out | Out-String).Trim()
  if (-not $raw) { Write-Err "migration-status khong tra ve gi (node loi?)"; return $null }
  $status = $null
  try { $status = $raw | ConvertFrom-Json }
  catch { Write-Err ("migration-status tra ve JSON hong: " + $raw); return $null }
  if (-not $status.ok) { Write-Err ("khong do duoc migration: " + $status.error); return $null }
  return $status
}

function Invoke-Migrate {
  Write-Step "Migrate DB"
  Write-Host ("  .env dang dung : " + (Get-ActiveEnv))
  if (-not (Import-MigrateEnv)) { exit 1 }
  Write-Host ("  DB dich        : " + (Get-MaskedUrl $env:DATABASE_DIRECT_URL))
  Exec { pnpm db:migrate } "pnpm db:migrate"
  Write-Ok "Migrate xong"
}

# Chỉ áp migration cho mediaos_dev — KHÔNG tạo DB, KHÔNG seed lại (khác 'dev-online-db').
# Dùng khi mediaos_dev tụt migration so với repo (login 500 thay vì 401).
function Invoke-DevOnlineMigrate {
  Write-Step "DEV-ONLINE — chi MIGRATE mediaos_dev (khong tao DB, khong seed lai)"
  Import-DevOnlineEnv
  if (-not (Wait-Postgres)) { return }
  Exec { pnpm db:migrate } "pnpm db:migrate (mediaos_dev)"
  Write-Ok "mediaos_dev da o head migration"
}

# S6-SEC-ROTATE-1: script seed nay FAIL-CLOSED (apps/api/seed-target.mjs) — không khai DB đích thì DỪNG,
# và đích `mediaos`/`mediaos_dev` phải opt-in bằng ĐÚNG TÊN. Hàm này khai tường minh hộ người dùng thay
# vì để họ ăn exit 1 từ sâu trong script seed (FULL gate 2026-07-28: `m seed`/`m reset` đã gãy im lặng).
#   -AllowProtected: CHỈ Invoke-Reset truyền — nó vừa XOÁ SẠCH volume sau khi người dùng gõ "RESET".
function Invoke-Seed([switch]$AllowProtected) {
  Write-Step "Seed demo (base + full)"
  # SEED_DIRECT_URL do người dùng đặt = ý định TƯỜNG MINH "seed vào đúng DB này" ⇒ nó THẮNG .env.
  # (Phải đọc TRƯỚC Import-DotEnv để không bị lẫn, và phải GATE trên đích ĐÃ RESOLVE — bản trước gate
  #  trên DATABASE_DIRECT_URL rồi ghi đè SEED_DIRECT_URL, nên lời khuyên "đặt SEED_DIRECT_URL" in ra ở
  #  nhánh chặn KHÔNG BAO GIỜ chạy được. Chỉ dẫn sai còn tệ hơn không chỉ dẫn.)
  $explicit = $env:SEED_DIRECT_URL
  Import-DotEnv (Join-Path $Root ".env")
  $target = if ($explicit) { $explicit } else { $env:DATABASE_DIRECT_URL }
  if (-not $target) { throw "Không có SEED_DIRECT_URL lẫn DATABASE_DIRECT_URL -> không biết seed vào DB nào." }
  $dbName = ([uri]$target).AbsolutePath.TrimStart("/")
  if ((@("mediaos", "mediaos_dev") -contains $dbName) -and (-not $AllowProtected)) {
    Write-Err "DB đích '$dbName' được BẢO VỆ (PROD / dev-online) — seed demo tạo company demo + tài khoản quản trị lên dữ liệu THẬT."
    Write-Host "  Muốn seed lại DB này : dùng `m reset` (xoá sạch + migrate + seed, có xác nhận)." -ForegroundColor Yellow
    Write-Host "  Seed vào lane riêng  : `$env:SEED_DIRECT_URL='postgres://mediaos:<pw>@localhost:5432/mediaos_<lane>'; m seed" -ForegroundColor Yellow
    throw "seed bị chặn (fail-closed)"
  }
  $env:SEED_DIRECT_URL = $target
  if ($AllowProtected) { $env:SEED_ALLOW_PROTECTED_DB = $dbName }
  Push-Location (Join-Path $Root "apps\api")
  try {
    Exec { node demo-seed-base.mjs } "demo-seed-base"
    Exec { node demo-seed-full.mjs } "demo-seed-full"
  } finally { Pop-Location; $env:SEED_ALLOW_PROTECTED_DB = $null; $env:SEED_DIRECT_URL = $null }
  Write-Ok "Seed xong (DB: $dbName)"
}

# S6-SEC-ROTATE-1 (KI-043) — HÀM NÀY TỪNG LÀ NGUỒN TÁI NHIỄM.
# Trước 2026-07-28 nó `ALTER ROLE ... PASSWORD '<literal>'` với đúng ba chuỗi nằm trong repo PUBLIC.
# Hệ quả: rotate mật khẩu bao nhiêu lần cũng vô nghĩa — lần chạy `m roles` kế tiếp ÂM THẦM đặt lại cụm
# về chìa khoá public (đúng lớp lỗi KI-036: vá ngọn, để nguyên cái tự khôi phục).
# Giờ nó KHÔNG biết mật khẩu nào cả: chỉ nạp `.env` (không tracked) rồi uỷ quyền cho
# `scripts/setup-db-roles.mjs` — nơi DUY NHẤT đọc mật khẩu, và chỉ đọc từ env.
function Invoke-Roles {
  Write-Step "Sync DB role passwords <- .env (KHÔNG literal)"
  $envPath = Join-Path $Root ".env"
  if (-not (Test-Path $envPath)) {
    throw "Không có .env ở gốc repo -> không biết mật khẩu role nào. Chạy 'm prod-env' hoặc copy .env.example rồi điền."
  }
  Import-DotEnv $envPath
  foreach ($k in @("APP_DB_PASSWORD", "WORKER_DB_PASSWORD", "PGBOUNCER_AUTH_PASSWORD")) {
    if (-not (Get-Item ("Env:" + $k) -ErrorAction SilentlyContinue).Value) { throw ".env THIẾU $k -> không biết đặt mật khẩu nào." }
  }
  # Uỷ quyền cho rotate-db-roles.mjs, KHÔNG gọi thẳng setup-db-roles.mjs.
  # LÝ DO (FULL gate 2026-07-28 bắt): setup-db-roles nối qua TCP bằng chính DATABASE_DIRECT_URL, nên nó
  # CHỈ chạy được khi mật khẩu đã khớp. Mà đúng tình huống lệnh này sinh ra để chữa — "login báo sai mật
  # khẩu", tức .env và cụm ĐANG LỆCH — thì nó lại chết vì "password authentication failed". Bản literal
  # cũ luôn chữa được vì đi `docker exec` (local socket, trust). rotate-db-roles.mjs giữ đúng đường
  # bootstrap đó rồi mới gọi setup-db-roles => vừa không có literal, vừa không mất khả năng tự chữa.
  Exec { node scripts/rotate-db-roles.mjs } "rotate-db-roles"
  Write-Ok "Đã đồng bộ 5 role theo .env (kể cả khi mật khẩu đang lệch)"
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
  Invoke-Seed -AllowProtected
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

# ── PROD ops (re-build · cập nhật · restart các app ĐÃ deploy online) ──────────────────
# FE PROD = Cloudflare Pages (06-deploy-pages.ps1 tự bake VITE_* — KHÔNG đụng root .env).
# API PROD = service NSSM "MediaOS-API" chạy node apps\api\dist\main.js (cwd=repo root, đọc root .env).
# LMS PROD = service NSSM "MediaOS-LMS" chạy node server.mjs (cwd=apps\lms, PORT=3400, tunnel train.*).
#            apps\lms là workspace RIÊNG (fmc-app, Next.js+SQLite) — ngoài turbo/pnpm-workspace MediaOS.

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator)
}

# Mở cửa sổ PowerShell Administrator (UAC) chạy lại 'mediaos.ps1 <lệnh>' — dùng khi bước cần admin
# (restart/cài service) mà phiên hiện tại không có quyền. Cửa sổ giữ mở để đọc kết quả.
function Invoke-Elevated([string]$cmdLine) {
  $ps1 = Join-Path $Root "mediaos.ps1"
  # Prompt ASCII (không dấu) — codepage cửa sổ mới có thể chưa là UTF-8.
  $inner = "& '$ps1' $cmdLine; Write-Host ''; Read-Host 'Xong - Enter de dong cua so'"
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"$inner`""
}

$ApiHealthHint = "xem logs\api.err.log (thường: .env sai / DB thiếu migration / KEK thiếu)."
$LmsHealthHint = "xem log service MediaOS-LMS (apps\lms — Next.js server.mjs, PORT=3400)."
# fbpost fail-fast khi thiếu KEK / SOCIAL_SESSION_SECRET — đó là CHỦ Ý (không khởi động im lặng với
# token nằm thô), nên hai nguyên nhân đó phải nằm ngay trong gợi ý chẩn đoán.
$SocialHealthHint = "xem apps\fbpost\social.err.log (thường: thiếu .secrets\fbpost-kek.bin hoặc SOCIAL_SESSION_SECRET trong .env.production)."

function Wait-HttpOk([string]$url, [string]$label, [string]$hint) {
  Write-Host "  chờ $label trả HTTP OK ($url, tối đa 60s) ..." -ForegroundColor DarkGray
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 3
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 4
      Write-Ok ("$label OK (HTTP " + $r.StatusCode + ")")
      return $true
    } catch { }
  }
  Write-Err "$label chưa phản hồi sau 60s — $hint"
  return $false
}

# Restart 1 service PROD + chờ health. Chỉ gọi khi ĐÃ có quyền Administrator.
function Restart-OneProdService([string]$svcName, [string]$healthUrl, [string]$label, [string]$hint) {
  $svc = Get-Service $svcName -ErrorAction SilentlyContinue
  if (-not $svc) { Write-Err "Chưa có service $svcName trên máy này — cài service trước rồi mới restart được."; return }
  Restart-Service -Name $svcName -Force
  Write-Ok "Đã restart $svcName"
  $null = Wait-HttpOk $healthUrl $label $hint
}

# Khởi động lại service PROD (KHÔNG rebuild):  m prod-restart [api|lms|social]  — bỏ trống = CẢ BA.
# Cần Administrator — chưa có thì tự mở cửa sổ UAC chạy lại đúng lệnh.
function Invoke-ProdRestart([string[]]$rArgs) {
  $target = "all"
  if ($rArgs.Count -gt 0 -and $rArgs[0]) { $target = $rArgs[0].ToLower() }
  if (@("all", "api", "lms", "social") -notcontains $target) {
    Write-Warn "Cách dùng:  m prod-restart [api|lms|social]   (bỏ trống = cả ba)"
    return
  }
  Write-Step "PROD — restart service ($target)"
  if (-not (Test-IsAdmin)) {
    Write-Warn "Cần Administrator để restart service — mở cửa sổ elevated (UAC)..."
    Invoke-Elevated "prod-restart $target"
    return
  }
  if (@("all", "api") -contains $target) {
    Restart-OneProdService $ProdApiService "http://localhost:$ApiPort/api/v1/health" "API PROD" $ApiHealthHint
  }
  if (@("all", "lms") -contains $target) {
    Restart-OneProdService $ProdLmsService "http://localhost:$LmsPort" "LMS PROD" $LmsHealthHint
  }
  if (@("all", "social") -contains $target) {
    # Đích health là /login: trang DUY NHẤT không cần phiên. Trỏ vào "/" sẽ nhận 307 về /login và
    # Wait-HttpOk có thể hiểu nhầm là chưa sẵn sàng.
    Restart-OneProdService $ProdSocialService "http://localhost:$SocialPort/login" "SOCIAL PROD" $SocialHealthHint
  }
}

# In danh sách có TRẦN, và NÓI RÕ đã cắt bao nhiêu (deploy bình thường chỉ tồn đọng vài migration; DB
# rỗng/lệch gốc thì cả trăm — cắt im lặng sẽ khiến người đọc tưởng đã thấy hết).
$ListCap = 15
function Write-ListCapped($items, [scriptblock]$fmt) {
  $i = 0
  foreach ($item in $items) {
    if ($i -ge $ListCap) {
      Write-Host ("      ... va {0} dong nua (xem het: node scripts\windows\migration-status.mjs)" -f ($items.Count - $ListCap)) -ForegroundColor DarkGray
      break
    }
    Write-Host (& $fmt $item) -ForegroundColor Yellow
    $i++
  }
}

# S5-DEVOPS-DEPLOYMIG-1 — bước MIGRATE của prod-update, đặt GIỮA "build api" và restart service.
# VÌ SAO CÓ: trước đây prod-update = build + restart, KHÔNG migrate ⇒ dist mới chạy trên schema cũ và lỗi
# chỉ lộ ra ở runtime, trong job nền, dưới dạng log rác (sự cố PROD 2026-07-24: thiếu mig 0511 ⇒
# SYSTEM_JOB_RUNS_RETENTION Failed mỗi nhịp, api.err.log phình 149 MB, 190/196 migration đã áp).
#
# FAIL-CLOSED: trả $false ở MỌI ngã không chắc chắn (thiếu .env · không đo được · DB lỗi · người huỷ ·
# migrate exit≠0 · migrate xong mà VẪN còn tồn đọng) ⇒ người gọi KHÔNG restart. Trạng thái xấu nhất KHÔNG
# phải "service cũ chạy tiếp" mà là "dist mới chạy trên schema cũ".
#
# Xuất ra CONSOLE của cửa sổ elevated (UAC) → dùng ASCII không dấu, khớp ghi chú ở Invoke-Elevated.
function Invoke-ProdMigrateStep {
  Write-Host "  migrate DB TRUOC khi restart (fail-closed) ..." -ForegroundColor DarkGray
  if (-not (Import-MigrateEnv)) { return $false }
  Write-Host ("    DB dich : " + (Get-MaskedUrl $env:DATABASE_DIRECT_URL))
  $st = Get-MigrationStatus
  if (-not $st) { return $false }
  if ($st.skew) { Write-Warn ("LECH journal/DB: " + $st.skew) }

  if ($st.pendingCount -eq 0) {
    Write-Ok ("schema da o head ({0}/{1}) - bo qua migrate" -f $st.appliedCount, $st.journalCount)
    return $true
  }

  Write-Warn ("TON DONG {0} migration - se ap TRUOC khi restart:" -f $st.pendingCount)
  Write-ListCapped $st.pendingTags { param($tag) "      - $tag" }

  # Expand-contract (memory migration-expand-contract-required): EXPAND (thêm bảng/cột/hàm) áp trước restart
  # là an toàn; CONTRACT (REVOKE/DROP) chỉ an toàn khi dist ĐANG CHẠY đã hết dùng đối tượng bị gỡ — máy
  # KHÔNG biết điều đó ⇒ hỏi người, không tự quyết.
  if ($st.contractCount -gt 0) {
    Write-Warn ("Lo nay co {0} cau lenh CONTRACT (REVOKE/DROP):" -f $st.contractCount)
    Write-ListCapped $st.contract { param($c) "      {0}:{1} [{2}] {3}" -f $c.tag, $c.line, $c.kind, $c.snippet }
    Write-Warn "CONTRACT chi an toan khi dist DANG CHAY da het dung doi tuong bi go (expand-contract)."
    if ($env:MEDIAOS_MIGRATE_YES -eq "1") {
      Write-Warn "MEDIAOS_MIGRATE_YES=1 -> tu xac nhan, khong hoi."
    } else {
      # Read-Host NÉM khi host không tương tác (chạy từ script/CI) — bắt lấy để fail-closed KÈM cách đi tiếp,
      # thay vì để exception thô nổi lên với thông báo khó hiểu.
      $ans = $null
      try { $ans = Read-Host 'Go "MIGRATE" de xac nhan ap ca lo (rong = huy, KHONG restart)' }
      catch {
        Write-Err "Khong hoi duoc (host khong tuong tac) -> KHONG migrate, KHONG restart."
        Write-Err "Chay lai trong cua so PowerShell tuong tac, hoac dat MEDIAOS_MIGRATE_YES=1 neu da duyet lo nay."
        return $false
      }
      if ($ans -ne "MIGRATE") { Write-Err "Da huy theo yeu cau -> KHONG migrate, KHONG restart."; return $false }
    }
  }
  if ($st.routineCount -gt 0) {
    Write-Host ("    ({0} cau DROP ... IF EXISTS kieu dung-lai - khong hoi)" -f $st.routineCount) -ForegroundColor DarkGray
  }

  # Out-Host: stdout của native command là OUTPUT STREAM của hàm — không chặn thì giá trị trả về thành
  # mảng [log..., $false] và `-not` trên mảng KHÁC RỖNG = $false ⇒ fail-OPEN (vẫn restart dù migrate đỏ).
  pnpm db:migrate | Out-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Err ("pnpm db:migrate THAT BAI (exit {0}) - KHONG restart service." -f $LASTEXITCODE)
    return $false
  }

  # Đo LẠI: exit 0 chưa chứng minh schema ở head (drizzle bỏ qua IM LẶNG khi journal/DB lệch gốc).
  $after = Get-MigrationStatus
  if (-not $after) { Write-Err "migrate xong nhung KHONG do lai duoc trang thai - KHONG restart."; return $false }
  if ($after.pendingCount -ne 0) {
    Write-Err ("migrate xong ma VAN con {0} ton dong (dau tien: {1}) - KHONG restart." -f $after.pendingCount, $after.firstPendingTag)
    return $false
  }
  Write-Ok ("migrate xong: {0}/{1} da ap - schema o head ({2})" -f $after.appliedCount, $after.journalCount, $after.headTag)
  return $true
}

# PROD UPDATE — re-build + cập nhật + khởi động lại các app đã deploy online:
#   m prod-update              → FE (Pages) + API + LMS
#   m prod-update fe|api|lms   → chỉ 1 phần    ('be' = API + LMS — bước elevated dùng nội bộ)
# API: build ĐÚNG cặp filter của 04-build-install-service.ps1 (contracts + api) rồi restart service —
# nhanh hơn 'm deploy-api' (không gỡ/cài lại service). Đổi cấu hình service/node path → vẫn 'm deploy-api'.
# LMS: apps\lms là workspace RIÊNG (fmc-app) → build tại chỗ ('pnpm build' = next build) rồi restart
# service. Deps LMS đổi thì tự chạy 'pnpm install' trong apps\lms trước.
function Invoke-ProdUpdate([string[]]$updArgs) {
  $target = "all"
  if ($updArgs.Count -gt 0 -and $updArgs[0]) { $target = $updArgs[0].ToLower() }
  if (@("all", "fe", "api", "lms", "social", "be") -notcontains $target) {
    Write-Warn "Cách dùng:  m prod-update [fe|api|lms|social]   (bỏ trống = FE + API + LMS + SOCIAL)"
    return
  }
  Write-Step "PROD UPDATE ($target) -> $DefaultDomain"
  if (@("all", "fe") -contains $target) { Invoke-DeployFe @() }
  if ($target -eq "fe") { return }
  $doApi    = @("all", "be", "api") -contains $target
  $doLms    = @("all", "be", "lms") -contains $target
  $doSocial = @("all", "be", "social") -contains $target

  if (-not (Test-IsAdmin)) {
    # 'all' → 'be' để KHÔNG deploy FE lần thứ hai trong cửa sổ elevated (FE đã chạy ở trên, không cần
    # quyền admin). Mọi target khác truyền NGUYÊN VẸN — chuỗi if lồng nhau kiểu cũ chỉ suy được api/lms
    # nên target thứ ba (social) sẽ bị nó đổi thành 'lms' và chạy nhầm hẳn app khác.
    $next = if ($target -eq "all") { "be" } else { $target }
    Write-Warn "Bước restart service cần Administrator — mở cửa sổ elevated (UAC) chạy tiếp ($next)..."
    Invoke-Elevated "prod-update $next"
    return
  }

  if ($doApi) {
    # Landmine prod-dist-shared: dev-online watch ghi đè cùng apps/api/dist → dừng nó trước khi build.
    if (Test-Port 3200) {
      Write-Warn "dev-online API (:3200) đang chạy — dist API DÙNG CHUNG với PROD."
      Write-Warn "Nên 'm dev-online-stop' trước, kẻo watch ghi đè dist vừa build cho PROD."
    }
    Write-Host "  build contracts + api ..." -ForegroundColor DarkGray
    Exec { pnpm --filter "@mediaos/contracts" build } "build contracts"
    Exec { pnpm --filter "@mediaos/api" build } "build api"
    # S6-REL-1 (D3, KI-016) — đóng băng dist vừa build thành release BẤT BIẾN.
    # ĐÓNG GÓI trước migrate (gói hỏng thì chưa hề đụng DB) nhưng CHƯA trỏ 'current': nếu migrate
    # DỪNG fail-closed mà 'current' đã trỏ bản mới, thì một lần restart bất kỳ (crash / reboot /
    # NSSM AppExit Restart) sẽ khởi động BẢN MỚI TRÊN SCHEMA CŨ — đúng thứ bước migrate sinh ra để
    # chặn. Kích hoạt nằm SAU migrate, xem bên dưới.
    Exec { node scripts/release-artifact.mjs snapshot --no-activate } "snapshot release"
    # S5-DEVOPS-DEPLOYMIG-1 — MIGRATE giữa build và restart. Build TRƯỚC migrate: build đỏ thì chưa hề
    # đụng DB. Migrate TRƯỚC restart: dist mới luôn gặp schema >= cái nó cần.
    # So sánh `-ne $true` (không phải `-not`): mảng lọt vào cũng rơi về nhánh DỪNG (fail-closed).
    $migrateOk = Invoke-ProdMigrateStep
    if ($migrateOk -ne $true) {
      Write-Err "FAIL-CLOSED: schema chua o head -> KHONG restart API PROD (dist moi + schema cu = loi runtime o job nen)."
      Write-Err "Sua xong chay lai 'm prod-update api'. Xem trang thai: 'm prod-status'. Chi migrate: 'm migrate'."
      Write-Warn "Release da dong goi nhung CHUA kich hoat — 'current' van tro ban CU (an toan)."
      exit 1
    }
    # Schema đã ở head ⇒ giờ mới trỏ 'current' sang bản vừa đóng gói, rồi mới restart.
    Exec { node scripts/release-artifact.mjs activate --latest } "activate release"
    Exec { node scripts/release-artifact.mjs verify } "verify release"
    Restart-OneProdService $ProdApiService "http://localhost:$ApiPort/api/v1/health" "API PROD" $ApiHealthHint
    Write-Host "  Ban dang chay: curl http://localhost:$ApiPort/api/v1/health  (doc .data.build)" -ForegroundColor DarkGray
    Write-Host "  Smoke:         node scripts\release-smoke.mjs" -ForegroundColor DarkGray
  }
  if ($doLms) {
    Write-Host "  build LMS (apps\lms — next build, workspace riêng ngoài turbo) ..." -ForegroundColor DarkGray
    Push-Location (Join-Path $Root "apps\lms")
    try { Exec { pnpm build } "build lms (next build)" } finally { Pop-Location }
    Restart-OneProdService $ProdLmsService "http://localhost:$LmsPort" "LMS PROD" $LmsHealthHint
  }
  if ($doSocial) {
    # apps\fbpost dùng NPM (package-lock.json), KHÔNG pnpm — hàng rào R3 của DECISIONS-08 loại nó khỏi
    # pnpm workspace. Gọi `pnpm build` ở đây sẽ chạy sai package manager và hỏng lock.
    Write-Host "  build SOCIAL (apps\fbpost — next build, workspace riêng dùng npm) ..." -ForegroundColor DarkGray
    Push-Location (Join-Path $Root "apps\fbpost")
    try { Exec { npm run build } "build social (next build)" } finally { Pop-Location }
    Restart-OneProdService $ProdSocialService "http://localhost:$SocialPort/login" "SOCIAL PROD" $SocialHealthHint

    # Cổng phiên là thứ DUY NHẤT chắn giữa Internet và toàn bộ token Facebook của công ty. Health 200
    # ở /login KHÔNG chứng minh nó còn sống (trang đó vốn công khai), nên kiểm thêm một đường phải-401.
    try {
      $probe = Invoke-WebRequest -Uri "http://localhost:$SocialPort/api/pages" -UseBasicParsing -TimeoutSec 5
      Write-Err ("CONG PHIEN HONG: GET /api/pages tra HTTP " + $probe.StatusCode + ", ky vong 401.")
      Write-Err "KHONG mo fbpost ra ngoai cho toi khi sua xong (xem docs\DEVOPS\DEVOPS-14)."
    } catch {
      $sc = try { $_.Exception.Response.StatusCode.value__ } catch { 0 }
      if ($sc -eq 401) { Write-Ok "cổng phiên OK (GET /api/pages -> 401)" }
      else { Write-Err ("CONG PHIEN bat thuong: GET /api/pages -> " + $sc + ", ky vong 401.") }
    }
  }
}

# Khối "migration" của `m prod-status` — CHỈ ĐỌC và KHÔNG BAO GIỜ throw (đây là lệnh xem trạng thái:
# đo được thì báo, không đo được thì nói rõ, chứ không làm hỏng phần còn lại của báo cáo).
# Trả lời đúng câu hỏi đã ngã ngựa 2026-07-24: "dist đang chạy có đang ngồi trên schema cũ không?"
function Show-MigrationStatus {
  Write-Host "  Migration (journal repo <-> drizzle.__drizzle_migrations):" -ForegroundColor DarkGray
  if (-not (Import-MigrateEnv)) { return }
  Write-Host ("    DB dich : " + (Get-MaskedUrl $env:DATABASE_DIRECT_URL))
  $st = Get-MigrationStatus
  if (-not $st) { return }
  if ($st.skew) { Write-Warn ("LECH journal/DB: " + $st.skew) }
  if ($st.pendingCount -eq 0) {
    Write-Ok ("migration {0}/{1} da ap - schema o head ({2})" -f $st.appliedCount, $st.journalCount, $st.headTag)
    return
  }
  Write-Warn ("migration {0}/{1} da ap - TON DONG {2}, dau tien chua ap: {3}" -f `
    $st.appliedCount, $st.journalCount, $st.pendingCount, $st.firstPendingTag)
  if ($st.contractCount -gt 0) {
    Write-Warn ("lo ton dong co {0} cau lenh CONTRACT (REVOKE/DROP) - se hoi xac nhan khi ap" -f $st.contractCount)
  }
  Write-Host "    Ap bang:  m prod-update api   (migrate xong moi restart)" -ForegroundColor DarkGray
}

# ── S6-REL-1 (D3 · KI-016) — RELEASE ARTIFACT & ROLLBACK ỨNG DỤNG ───────────────────────────
# Trước WO này service PROD chạy THẲNG apps\api\dist — thư mục mà 'm dev-online' biên dịch lại
# (sự cố 2026-07-08) — và vì dist bị ghi đè mỗi lần build nên KHÔNG có bản trước để quay về.
# Nay: mỗi build đóng băng thành apps\api\releases\<stamp>, service trỏ junction ...\releases\current.
# Logic ở scripts\release-artifact.mjs (đa nền tảng, đã verify phân giải node_modules bằng resolver thật).

# Khối "release" của m prod-status — CHỈ ĐỌC, KHÔNG BAO GIỜ throw.
# Trả lời: "service đang trỏ vào đâu, và bản đang chạy có phải bản mới nhất không?"
function Show-ReleaseStatus {
  Write-Host "  Release artifact (apps\api\releases):" -ForegroundColor DarkGray
  # ⚠️ ImagePath của một service NSSM = đường dẫn tới **nssm.exe**, KHÔNG BAO GIỜ chứa đường dẫn .js.
  # Mục tiêu thật nằm ở subkey `Parameters\Application` + `Parameters\AppParameters` (đó chính là thứ
  # `m prod-cutover` ghi bằng `nssm set`). Đọc nhầm ImagePath ⇒ phép thử `-match "releases"` không bao
  # giờ đúng ⇒ ô này báo "KI-016 CHƯA đóng" VĨNH VIỄN, kể cả khi cutover đã chạy xong từ lâu — tức một
  # tín hiệu NO-GO GIẢ cho cổng G4 của RELEASE-10.
  $svcPath = $null
  try {
    $p = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$ProdApiService\Parameters" -ErrorAction Stop
    $svcPath = ("{0} {1}" -f $p.Application, $p.AppParameters).Trim()
  } catch {
    try {
      $reg = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$ProdApiService" -ErrorAction Stop
      $svcPath = $reg.ImagePath
      Write-Warn "khong doc duoc $ProdApiService\Parameters — doc tam ImagePath (co the bao sai o cutover)"
    } catch { Write-Warn "khong doc duoc cau hinh service $ProdApiService (can quyen doc registry)" }
  }

  if ($svcPath) {
    if ($svcPath -match "releases") {
      Write-Ok "service tro vao releases\current (da tach khoi dist dung chung)"
    } else {
      Write-Warn "service VAN tro thang apps\api\dist — KI-016 CHUA dong o may nay."
      Write-Warn "  => 'm dev-online' bien dich lai dist co the day binary moi vao PROD."
      Write-Host "     Cutover (Administrator):  m prod-cutover        (xem docs/RELEASE/RELEASE-08)" -ForegroundColor DarkGray
    }
  }

  $out = & node (Join-Path $Root "scripts\release-artifact.mjs") list 2>&1
  $out | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor DarkGray }
}

# m prod-rollback [<stamp>]  — quay ung dung ve ban truoc (KHONG dung toi DB).
# Bo trong = ban NGAY TRUOC ban dang chay. Can Administrator vi co buoc restart service.
function Invoke-ProdRollback([string[]]$rbArgs) {
  Write-Step "PROD — ROLLBACK ứng dụng (không đụng DB)"
  Write-Warn "Rollback ứng dụng KHÔNG hoàn tác migration. Schema đi theo expand-contract (DEVOPS-10):"
  Write-Warn "bản cũ phải chạy được trên schema MỚI. Nếu lỗi do DỮ LIỆU thì đây không phải cách chữa."
  if (-not (Test-IsAdmin)) {
    Write-Warn "Bước restart service cần Administrator — mở cửa sổ elevated (UAC)..."
    Invoke-Elevated ("prod-rollback " + ($rbArgs -join " "))
    return
  }
  $rbArgs2 = @("rollback") + $rbArgs
  Exec { & node (Join-Path $Root "scripts\release-artifact.mjs") @rbArgs2 } "rollback release"
  Exec { & node (Join-Path $Root "scripts\release-artifact.mjs") verify } "verify release"
  Restart-OneProdService $ProdApiService "http://localhost:$ApiPort/api/v1/health" "API PROD" $ApiHealthHint
  Write-Host "  Kiểm chứng bản đang chạy:  curl http://localhost:$ApiPort/api/v1/health   (đọc .data.build)" -ForegroundColor DarkGray
  Write-Host "  Smoke:  node scripts\release-smoke.mjs" -ForegroundColor DarkGray
}

# m prod-cutover — MOT LAN: tro service PROD tu apps\api\dist sang apps\api\releases\current.
# Tach rieng khoi prod-update vi doi cau hinh service la hanh dong CO CHU DICH cua owner, khong
# duoc xay ra nhu tac dung phu cua mot lan deploy thuong.
function Invoke-ProdCutover {
  Write-Step "PROD — cutover service sang releases\current (KI-016)"
  if (-not (Test-IsAdmin)) {
    Write-Warn "Cần Administrator để đổi cấu hình service — mở cửa sổ elevated (UAC)..."
    Invoke-Elevated "prod-cutover"
    return
  }
  $current = Join-Path $Root "apps\api\releases\current\main.js"
  if (-not (Test-Path $current)) {
    Write-Err "Chưa có apps\api\releases\current\main.js — chạy 'm prod-update api' (hoặc build + snapshot) trước."
    return
  }
  Exec { & node (Join-Path $Root "scripts\release-artifact.mjs") verify } "verify release truoc khi cutover"
  $nodeExe = (Get-Command node).Source
  Exec { nssm set $ProdApiService Application "$nodeExe" } "nssm set Application"
  Exec { nssm set $ProdApiService AppParameters "apps\api\releases\current\main.js" } "nssm set AppParameters"
  Write-Ok "Da tro service sang releases\current"
  Restart-OneProdService $ProdApiService "http://localhost:$ApiPort/api/v1/health" "API PROD" $ApiHealthHint
  Write-Host "  Quay lai duong cu neu can:  nssm set $ProdApiService AppParameters `"apps\api\dist\main.js`"" -ForegroundColor DarkGray
}

function Invoke-ProdStatus {
  Write-Step "PROD — trạng thái ($DefaultDomain)"
  foreach ($name in @($ProdApiService, $ProdLmsService, $ProdSocialService, "cloudflared")) {
    $svc = Get-Service $name -ErrorAction SilentlyContinue
    if (-not $svc) { Write-Warn ("service {0,-15}: chưa cài" -f $name) }
    elseif ($svc.Status -eq "Running") { Write-Ok ("service {0,-15}: Running" -f $name) }
    else { Write-Err ("service {0,-15}: {1}" -f $name, $svc.Status) }
  }
  Write-Host ""
  if (Test-Port $ApiPort) { Write-Ok "cổng :$ApiPort (API PROD) đang mở" } else { Write-Err "cổng :$ApiPort (API PROD) đóng" }
  if (Test-Port $LmsPort) { Write-Ok "cổng :$LmsPort (LMS PROD) đang mở" } else { Write-Err "cổng :$LmsPort (LMS PROD) đóng" }
  if (Test-Port $SocialPort) { Write-Ok "cổng :$SocialPort (SOCIAL PROD) đang mở" } else { Write-Err "cổng :$SocialPort (SOCIAL PROD) đóng" }
  if (Test-Port 3200)     { Write-Warn "cổng :3200 (dev-online API) CŨNG đang chạy — nhớ landmine dist dùng chung" }
  Write-Host ""
  Show-MigrationStatus
  Write-Host ""
  Show-ReleaseStatus
  Write-Host ""
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$ApiPort/api/v1/health" -UseBasicParsing -TimeoutSec 4
    Write-Ok ("health API local  http://localhost:$ApiPort/api/v1/health (HTTP " + $r.StatusCode + ")")
  } catch { Write-Err "health API local KHÔNG phản hồi — service dừng hoặc API lỗi (logs\api.err.log)" }
  try {
    $r = Invoke-WebRequest -Uri "https://api.$DefaultDomain/api/v1/health" -UseBasicParsing -TimeoutSec 8
    Write-Ok ("health API online https://api.$DefaultDomain/api/v1/health (HTTP " + $r.StatusCode + ")")
  } catch { Write-Err "health API online KHÔNG phản hồi — kiểm tra service cloudflared / DNS" }
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$LmsPort" -UseBasicParsing -TimeoutSec 4
    Write-Ok ("health LMS local  http://localhost:$LmsPort (HTTP " + $r.StatusCode + ")")
  } catch { Write-Err "health LMS local KHÔNG phản hồi — service MediaOS-LMS dừng hoặc lỗi" }
  try {
    $r = Invoke-WebRequest -Uri "https://train.$DefaultDomain" -UseBasicParsing -TimeoutSec 8
    Write-Ok ("health LMS online https://train.$DefaultDomain (HTTP " + $r.StatusCode + ")")
  } catch { Write-Err "health LMS online KHÔNG phản hồi — kiểm tra cloudflared / DNS" }
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$SocialPort/login" -UseBasicParsing -TimeoutSec 4
    Write-Ok ("health SOCIAL local http://localhost:$SocialPort/login (HTTP " + $r.StatusCode + ")")
  } catch { Write-Err "health SOCIAL local KHÔNG phản hồi — service MediaOS-Social dừng hoặc lỗi" }
  # 404 ở đây có nghĩa RẤT CỤ THỂ: DNS + tunnel tới được, nhưng config.yml của cloudflared chưa có
  # ingress rule cho hostname này (rơi vào quy tắc bắt-tất-cả http_status:404). Phân biệt được với
  # "không phản hồi" (DNS/tunnel chết) giúp khỏi đi mò nhầm chỗ.
  try {
    $r = Invoke-WebRequest -Uri "https://$SocialSubdomain.$DefaultDomain/login" -UseBasicParsing -TimeoutSec 8
    Write-Ok ("health SOCIAL online https://$SocialSubdomain.$DefaultDomain/login (HTTP " + $r.StatusCode + ")")
  } catch {
    $sc = try { $_.Exception.Response.StatusCode.value__ } catch { 0 }
    if ($sc -eq 404) { Write-Err "SOCIAL online 404 — cloudflared THIẾU ingress rule cho $SocialSubdomain.$DefaultDomain (DNS/tunnel vẫn OK)" }
    else { Write-Err "health SOCIAL online KHÔNG phản hồi — kiểm tra cloudflared / DNS" }
  }
  # Đo luôn cổng phiên trong `prod-status`: một fbpost "chạy tốt" mà cổng phiên chết là tình huống
  # nguy hiểm NHÌN KHÔNG RA — health 200 vẫn xanh trong khi token Facebook mở toang.
  try {
    $probe = Invoke-WebRequest -Uri "http://localhost:$SocialPort/api/pages" -UseBasicParsing -TimeoutSec 4
    Write-Err ("SOCIAL cổng phiên HỎNG: /api/pages trả HTTP " + $probe.StatusCode + " (kỳ vọng 401)")
  } catch {
    $sc = try { $_.Exception.Response.StatusCode.value__ } catch { 0 }
    if ($sc -eq 401) { Write-Ok "SOCIAL cổng phiên OK (/api/pages -> 401)" }
    elseif ($sc -eq 0) { Write-Warn "SOCIAL cổng phiên: không đo được (service không phản hồi)" }
    else { Write-Err ("SOCIAL cổng phiên bất thường: /api/pages -> " + $sc + " (kỳ vọng 401)") }
  }
  # Cầu SSO phía API: 404 = dist đang chạy CHƯA có module social (deploy chưa tới nơi), 401 = có route.
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$ApiPort/api/v1/integrations/social/sso-link" -UseBasicParsing -TimeoutSec 4
    Write-Warn ("cầu SSO social trả HTTP " + $r.StatusCode + " khi CHƯA xác thực — bất thường, kỳ vọng 401")
  } catch {
    $sc = try { $_.Exception.Response.StatusCode.value__ } catch { 0 }
    if ($sc -eq 401) { Write-Ok "cầu SSO social OK (API có route, trả 401 khi chưa xác thực)" }
    elseif ($sc -eq 404) { Write-Err "cầu SSO social 404 — API PROD đang chạy DIST CŨ, chạy 'm prod-update api'" }
    elseif ($sc -eq 503) { Write-Err "cầu SSO social 503 — thiếu SOCIAL_SSO_SECRET/BASE_URL/COMPANY_ID trong apps\api\.env" }
    else { Write-Warn ("cầu SSO social: không đo được (HTTP " + $sc + ")") }
  }
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
  # 1) Kill theo cổng LISTENING — bắt tiến trình API/vite đang phục vụ.
  foreach ($port in @(3200, 5273, 5275, 5278)) {
    $procIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $procIds) {
      if ($procId -and $procId -ne 0) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    }
  }
  # 2) Dọn tiến trình dev-online MỒ CÔI KHÔNG còn listen: `nest start --watch` mà app con đã chết vẫn
  #    sống + giữ mở dev\logs\api-online.log ⇒ lần chạy sau `>` không truncate được log → api-online chết
  #    ngay, chỉ 3 SPA lên. Pass (1) theo cổng bỏ sót nó (không listen). Chỉ khớp node.exe của CHÍNH repo
  #    này (apps\{api,app,auth,console}) + chữ ký watch/vite.
  #    AN TOÀN với PROD: PROD API = `node dist/main` (KHÔNG có 'nest'/'--watch'); PROD web = Cloudflare Pages
  #    (không có tiến trình node) ⇒ không khớp chữ ký, không bị kill.
  $sig = [regex]::Escape($Root) + '\\apps\\(api|app|auth|console)\b'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match $sig) -and ($_.CommandLine -match '\bnest\b|--watch|\bvite\b') } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # Cho OS nhả handle log + cổng trước khi khởi động lại (tránh sharing-violation lúc truncate log).
  Start-Sleep -Milliseconds 600
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
  Write-Ok "Đã dừng server dev-online (tiến trình ẩn đã bị kết thúc theo cổng)."
}

# Xem log tiến trình ẩn (dev\logs\). Không tham số → liệt kê; có tên → tail -f (Ctrl+C để thoát).
function Invoke-DevOnlineLogs([string[]]$logArgs) {
  $logDir = Join-Path $Root "dev\logs"
  if (-not (Test-Path $logDir)) { Write-Warn "Chưa có log — chạy 'm dev-online' / 'm dev-online-fast' trước."; return }
  $name = $null
  if ($logArgs.Count -gt 0) { $name = $logArgs[0] }
  if (-not $name) {
    Write-Step "Log dev-online (dev\logs\)"
    $logs = Get-ChildItem $logDir -Filter *.log -ErrorAction SilentlyContinue
    if (-not $logs) { Write-Warn "Chưa có file log nào."; return }
    foreach ($f in $logs) {
      Write-Host ("  {0,-16} {1,9:N0} B  {2}" -f $f.BaseName, $f.Length, $f.LastWriteTime)
    }
    Write-Host ""
    Write-Host "  Theo dõi 1 log:  m dev-online-logs api-online   (hoặc gõ tắt: api / app / auth / console)"
    return
  }
  $log = Join-Path $logDir "$name.log"
  if (-not (Test-Path $log)) { $log = Join-Path $logDir "$name-online.log" }  # cho gõ tắt: api → api-online
  if (-not (Test-Path $log)) { Write-Err "Không thấy log: $name (xem danh sách bằng 'm dev-online-logs')"; return }
  Write-Step "Tail $log  (Ctrl+C để thoát)"
  Get-Content $log -Tail 40 -Wait
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
  # Chạy ẨN + log. Mỗi Vite bake VITE_TUNNEL_HOST riêng vào cmd (`set ...&& pnpm dev`) cho chắc, không phụ
  # thuộc kế thừa env. LƯU Ý: `&&` dán ngay sau giá trị (không dấu cách) để tránh trailing-space vào host.
  Start-HiddenApp "api-online"     "apps\api"     "pnpm dev"
  Start-HiddenApp "app-online"     "apps\app"     "set VITE_TUNNEL_HOST=cian-dev.funtimemediacorp.com&& pnpm dev"
  Start-HiddenApp "auth-online"    "apps\auth"    "set VITE_TUNNEL_HOST=cian-dev-auth.funtimemediacorp.com&& pnpm dev"
  Start-HiddenApp "console-online" "apps\console" "set VITE_TUNNEL_HOST=cian-dev-console.funtimemediacorp.com&& pnpm dev"
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
  Write-Warn "Chạy ẨN (không cửa sổ). Xem log: 'm dev-online-logs' · dừng: 'm dev-online-stop'."
}

function Invoke-DevOnlineTunnel {
  Write-Step "DEV-ONLINE TUNNEL — ingress cian-dev.* (cần Administrator)"
  & (Join-Path $Root "scripts\windows\07-tunnel-dev.ps1")
}

# dev-online-fast — như dev-online nhưng phục vụ BẢN BUILD toàn stack (không watch/HMR).
# Lý do FE: dev-mode không bundle ⇒ mỗi trang nạp hàng trăm module rời, mỗi request ~200-350ms qua tunnel
# ⇒ chuyển trang/lần vào đầu rất chậm. Bundle (vite preview) ⇒ 2-3 request/trang.
# Lý do API: `nest start --watch` mất ~16-30s biên dịch lại monolith khi khởi động/đổi file → request rơi
# vào cửa sổ đó (kể cả ĐĂNG NHẬP) bị timeout 30s qua tunnel. Chạy bản build `node dist/main.js` listen ~2-3s.
# Đổi lại KHÔNG có HMR/watch — sửa code (FE hay API) phải chạy lại lệnh này (hoặc `m dev-online` khi cần watch).
function Invoke-DevOnlineFast {
  Write-Step "DEV-ONLINE FAST — API :3200 + 3 SPA đều chạy BẢN BUILD (không watch/HMR)"
  Import-DevOnlineEnv
  Write-Host "  dừng server dev-online cũ (nếu có) → re-run sạch ..." -ForegroundColor DarkGray
  Stop-DevOnline
  Build-SharedPackages
  Write-Host "  build API + 3 SPA (VITE_* dev-online bake vào bundle; API → dist/main.js) ..." -ForegroundColor DarkGray
  Exec {
    pnpm exec turbo run build --filter=@mediaos/api --filter=@mediaos/app --filter=@mediaos/auth --filter=@mediaos/console --force
  } "build API + 3 SPA"
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  Start-HiddenApp "api-online"     "apps\api"     "node dist\main.js"
  Start-HiddenApp "app-online"     "apps\app"     "pnpm preview"
  Start-HiddenApp "auth-online"    "apps\auth"    "pnpm preview"
  Start-HiddenApp "console-online" "apps\console" "pnpm preview"
  Write-Host ""
  Write-Ok "Dev-online FAST đang chạy ẨN (bản build, API không watch — sửa code FE/API thì chạy lại 'm dev-online-fast')."
  Write-Host "    app     https://cian-dev.funtimemediacorp.com"
  Write-Host "    auth    https://cian-dev-auth.funtimemediacorp.com"
  Write-Host "    console https://cian-dev-console.funtimemediacorp.com"
  Write-Host ""
  Write-Host "  Login: demo / admin@demo.local / Admin@12345" -ForegroundColor Magenta
  Write-Warn "Chạy ẨN (không cửa sổ). Xem log: 'm dev-online-logs' · dừng: 'm dev-online-stop'."
}

# ── S5-DEVOPS-1: migrate-verify (DB ephemeral) + seed-staging (4 tài khoản UAT) ──────────
# Cả hai lệnh CHỈ dành cho cluster dev/dev-online cục bộ. LƯU Ý: KHÔNG check `.env` active — trên máy
# prod-host `.env` LUÔN là .env.prod (PROD service đọc nó) trong khi 2 lệnh này Import-DevOnlineEnv
# override session env; check .env chỉ chặn oan luồng UAT hợp lệ. Guard THẬT: (1) seed-staging chỉ chấp
# nhận DB đích mediaos_dev + script tự blocklist 'mediaos'; (2) migrate-verify chỉ CREATE/DROP tên
# ^mediaos_migverify_ qua admin conn 'postgres' (blocklist mediaos/mediaos_dev trong script).
# KHÔNG rebuild dist mà PROD service đang chạy (landmine prod-dist-shared) — chỉ gọi bash/node script có sẵn.

# Chứng minh migrate-from-empty (0000→head) trên DB ephemeral mediaos_migverify_* — tự DROP ở trap EXIT,
# KHÔNG chạm mediaos/mediaos_dev. Host Windows không có psql → fallback psql TRONG container qua
# MIGVERIFY_PSQL (script chỉ đổi cách gọi psql, guard/URL giữ nguyên).
function Invoke-MigrateVerify {
  Write-Step "MIGRATE-VERIFY — migrate-from-empty trên DB ephemeral (tự DROP, không chạm mediaos/mediaos_dev)"
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if (-not $bash) { Write-Err "Không thấy bash (cần Git Bash) — không chạy được scripts/migrate-verify-ephemeral.sh"; exit 1 }
  Import-DevOnlineEnv   # DATABASE_DIRECT_URL → cluster docker local; script CHỈ mượn host/cred để mint DB ephemeral
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    $env:MIGVERIFY_PSQL = "docker exec -i mediaos-postgres psql"
    Write-Host "  psql không có trên PATH -> dùng psql trong container (MIGVERIFY_PSQL)" -ForegroundColor DarkGray
  }
  try {
    Exec { & bash scripts/migrate-verify-ephemeral.sh --self-test } "GUARD self-test"
    Exec { & bash scripts/migrate-verify-ephemeral.sh } "migrate-verify"
  } finally { Remove-Item Env:MIGVERIFY_PSQL -ErrorAction SilentlyContinue }
  Write-Ok "Migrate-from-empty PASS — DB ephemeral đã tự DROP; mediaos/mediaos_dev không bị chạm."
}

# ── S6-PERF-DB-1: backup-drill (chứng minh backup KHÔI PHỤC ĐƯỢC) ────────────────────────────
# scripts/backup-restore-drill.sh có từ G16-2 nhưng CHƯA TỪNG chạy được kể từ khi Postgres vào
# container: host Windows không có pg_dump/pg_restore/psql trên PATH ⇒ script fail ở 3 dòng
# `command -v` ⇒ "backup khôi phục được" chỉ là giả định. Script nay tự fallback sang pg client
# TRONG container; wrapper này chỉ lo dựng env + bật Postgres, cùng khuôn Invoke-MigrateVerify.
#
# AN TOÀN: drill chỉ pg_dump READ-ONLY trên DB nguồn; DB tạm tên ^mediaos_drill_ và có guard
# blocklist (mediaos/mediaos_dev/postgres/template*) trước mọi DROP; trap EXIT tự dọn.
function Invoke-BackupDrill {
  Write-Step "BACKUP-DRILL — chứng minh backup KHÔI PHỤC ĐƯỢC (dump → restore DB tạm → verify → tự DROP)"
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if (-not $bash) { Write-Err "Không thấy bash (cần Git Bash) — không chạy được scripts/backup-restore-drill.sh"; exit 1 }
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  Exec { & bash scripts/backup-restore-drill.sh --self-test } "GUARD self-test"
  Exec { & bash scripts/backup-restore-drill.sh } "backup-restore drill"
  Write-Ok "Drill PASS — backup khôi phục được; DB tạm đã tự DROP."
}

# Seed 4 tài khoản UAT (Employee/Manager/HR/company-admin) lên mediaos_dev — idempotent, non-destructive.
# Cred đọc từ STAGING_SEED_* trong .env.dev-online (script fail-fast ≥12 ký tự TRƯỚC khi ghi DB,
# không log mật khẩu). Super Admin KHÔNG seed ở đây — qua PLATFORM_SUPERADMIN_* lúc boot API.
function Invoke-SeedStaging {
  Write-Step "SEED-STAGING — 4 tài khoản UAT (Employee/Manager/HR/company-admin) lên mediaos_dev"
  Import-DevOnlineEnv
  $target = $env:DATABASE_DIRECT_URL
  if (-not $target) { Write-Err ".env.dev-online thiếu DATABASE_DIRECT_URL"; exit 1 }
  # GUARD: DB đích PHẢI là mediaos_dev — wrapper này tuyệt đối không seed prod (mediaos) hay DB khác.
  $dbName = ($target -split '\?')[0]
  $dbName = $dbName.Substring($dbName.LastIndexOf('/') + 1)
  if ($dbName -ne "mediaos_dev") {
    Write-Err "GUARD: DB đích '$dbName' khác 'mediaos_dev' — từ chối (wrapper CHỈ dành cho UAT mediaos_dev)."
    exit 1
  }
  Exec { docker compose up -d } "docker compose up"
  if (-not (Wait-Postgres)) { return }
  Write-Host ("  DB dich        : " + ($target -replace '://([^:]+):[^@]+@', '://$1:***@'))
  node scripts/seed-staging-accounts.mjs
  if ($LASTEXITCODE -ne 0) { throw "seed-staging thất bại — kiểm tra STAGING_SEED_* trong .env.dev-online (fail-fast, KHÔNG ghi DB một phần)." }
  Write-Ok "Seed staging xong (idempotent — chạy lại không nhân bản; SA qua PLATFORM_SUPERADMIN_* lúc boot API)."
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
  Write-Host "    migrate           áp migration lên DB của .env đang active (in rõ DB đích trước khi chạy)"
  Write-Host "    seed              seed công ty demo + dữ liệu"
  Write-Host "    roles             sync mật khẩu DB role THEO .env (khi login báo sai mật khẩu)"
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
  Write-Host "  PROD ĐANG CHẠY (re-build · cập nhật · restart app đã deploy online)" -ForegroundColor Yellow
  Write-Host "    prod-update [fe|api|lms|social]  re-build + deploy FE Pages + rebuild API/LMS/SOCIAL + restart (UAC khi cần)"
  Write-Host "                              API: build -> MIGRATE -> restart. Migrate đỏ/huỷ = KHÔNG restart, exit 1."
  Write-Host "                              Lô tồn đọng có REVOKE/DROP thì HỎI xác nhận (bỏ qua: MEDIAOS_MIGRATE_YES=1)."
  Write-Host "    prod-restart [api|lms|social]    chỉ khởi động lại service PROD, KHÔNG rebuild/migrate (bỏ trống = cả ba)"
  Write-Host "    prod-status               service (API·LMS·cloudflared) · cổng · migration tồn đọng · release · health local + online"
  Write-Host "    prod-rollback [<stamp>]   quay API PROD về bản build TRƯỚC (không đụng DB); bỏ trống = ngay trước"
  Write-Host "    prod-cutover              MỘT LẦN: trỏ service từ apps\api\dist sang releases\current (KI-016)"
  Write-Host ""
  Write-Host "  DEV-ONLINE (lộ dev ra cian-dev.*.funtimemediacorp.com, song song prod)" -ForegroundColor Yellow
  Write-Host "    dev-online          chạy/restart dev stack lộ ra cian-dev.* (tự dừng cũ + rebuild shared)"
  Write-Host "    dev-online-fast     như dev-online nhưng API + 3 SPA đều chạy BẢN BUILD (nhanh/ổn định qua tunnel, không watch/HMR)"
  Write-Host "    dev-online-stop     dừng dev-online (giải phóng cổng 3200/5273/5275/5278)"
  Write-Host "    dev-online-logs     xem/tail log tiến trình ẩn (dev\logs\; vd: m dev-online-logs api)"
  Write-Host "    dev-online-db       tạo + migrate + SEED LẠI DB cô lập mediaos_dev (1 lần)"
  Write-Host "    dev-online-migrate  CHỈ migrate mediaos_dev (không tạo DB, không seed lại)"
  Write-Host "    dev-online-tunnel   tạo ingress cloudflared + DNS cho cian-dev.* (1 lần, Administrator)"
  Write-Host ""
  Write-Host "  STAGING / UAT (S5-DEVOPS-1 — luôn ép env dev-online; guard DB-đích, không đụng mediaos prod)" -ForegroundColor Yellow
  Write-Host "    migrate-verify      chứng minh migrate-from-empty (0000→head) trên DB ephemeral tự DROP"
  Write-Host "    backup-drill        chứng minh BACKUP KHÔI PHỤC ĐƯỢC (dump→restore DB tạm→verify RLS/index→tự DROP)"
  Write-Host "    seed-staging        seed 4 tài khoản UAT (Employee/Manager/HR/Admin) lên mediaos_dev — idempotent"
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
    Write-Host "  [19] MIGRATE DB           (áp migration mới — GIỮ NGUYÊN data)" -ForegroundColor Green
    Write-Host "   [6] RESET DB              [XOÁ SẠCH DATA]"
    Write-Host "   [7] Tắt INFRA             (docker compose down)"
    Write-Host "   [8] Sync DB roles <- .env (khi login báo sai mật khẩu)"
    Write-Host "   [9] STATUS                (docker · cổng · health)"
    Write-Host "  [10] Khôi phục .env PROD"
    Write-Host ""
    Write-Host "  --- DEV-ONLINE (lộ ra cian-dev.*, song song prod) ---" -ForegroundColor DarkCyan
    Write-Host "  [11] DEV-ONLINE          dev server + HMR (sửa FE thấy ngay)"
    Write-Host "  [12] DEV-ONLINE FAST     API + 3 SPA chạy bản build (nhanh/ổn định qua tunnel, KHÔNG watch/HMR)"
    Write-Host "  [13] Dừng dev-online"
    Write-Host "  [14] Dev-online: tạo DB mediaos_dev      (1 lần — tạo + migrate + SEED LẠI)"
    Write-Host "  [20] Dev-online: chỉ MIGRATE mediaos_dev (khi login báo 500 vì DB tụt migration)"
    Write-Host "  [15] Dev-online: ingress tunnel          (1 lần, Administrator)"
    Write-Host "  [18] Dev-online: xem log tiến trình ẩn   (dev\logs\)"
    Write-Host ""
    Write-Host "  --- PROD ($DefaultDomain — Pages + API :$ApiPort + LMS train. :$LmsPort + SOCIAL $SocialSubdomain. :$SocialPort + tunnel) ---" -ForegroundColor DarkCyan
    Write-Host "  [21] PROD UPDATE tất cả    re-build + deploy Pages + rebuild API/LMS/SOCIAL + MIGRATE + restart"
    Write-Host "  [22] PROD update chỉ FE    (build + deploy 3 SPA lên Cloudflare Pages)"
    Write-Host "  [23] PROD update chỉ API   (rebuild dist -> MIGRATE -> restart service — UAC nếu cần)" -ForegroundColor Green
    Write-Host "       ^ migrate đỏ/huỷ = KHÔNG restart (fail-closed); lô có REVOKE/DROP thì HỎI xác nhận"
    Write-Host "  [26] PROD update chỉ LMS   (next build apps\lms + restart service — UAC nếu cần)"
    Write-Host "  [27] PROD update chỉ SOCIAL (npm build apps\fbpost + restart + kiểm CỔNG PHIÊN — UAC nếu cần)"
    Write-Host "  [24] PROD restart 3 service (chỉ khởi động lại, KHÔNG rebuild, KHÔNG migrate)"
    Write-Host "  [25] PROD status           (service · cổng · MIGRATION tồn đọng · cổng phiên SOCIAL · health)"
    Write-Host ""
    Write-Host "  --- DASHBOARD tiến độ (chạy ẩn, cổng 5180) ---" -ForegroundColor DarkCyan
    Write-Host "  [16] Bật DASHBOARD (ẩn)    http://localhost:5180"
    Write-Host "  [17] Tắt DASHBOARD"
    Write-Host "   [0] Thoát"
    Write-Host ""
    $choice = Read-Host "Chọn (0-27)"
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
      "12" { Invoke-DevOnlineFast }
      "13" { Invoke-DevOnlineStop }
      "14" { Invoke-DevOnlineDb }
      "15" { Invoke-DevOnlineTunnel }
      "18" { Invoke-DevOnlineLogs @() }
      "16" { Invoke-Dashboard }
      "17" { Invoke-DashboardStop }
      "19" { Invoke-Migrate }
      "20" { Invoke-DevOnlineMigrate }
      "21" { Invoke-ProdUpdate @() }
      "22" { Invoke-ProdUpdate @("fe") }
      "23" { Invoke-ProdUpdate @("api") }
      "26" { Invoke-ProdUpdate @("lms") }
      "27" { Invoke-ProdUpdate @("social") }
      "24" { Invoke-ProdRestart @() }
      "25" { Invoke-ProdStatus }
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
  "prod-update"   { Invoke-ProdUpdate $Rest }
  "prod-restart"  { Invoke-ProdRestart $Rest }
  "prod-status"   { Invoke-ProdStatus }
  "prod-rollback" { Invoke-ProdRollback $Rest }   # S6-REL-1 (D3) — quay app về bản trước
  "prod-cutover"  { Invoke-ProdCutover }          # S6-REL-1 (D3) — một lần: dist → releases\current
  "dev-online"        { Invoke-DevOnline }
  "dev-online-fast"   { Invoke-DevOnlineFast }
  "dev-online-stop"   { Invoke-DevOnlineStop }
  "dev-online-logs"   { Invoke-DevOnlineLogs $Rest }
  "dev-online-db"      { Invoke-DevOnlineDb }
  "dev-online-migrate" { Invoke-DevOnlineMigrate }
  "dev-online-tunnel"  { Invoke-DevOnlineTunnel }
  "migrate-verify"     { Invoke-MigrateVerify }
  "backup-drill"       { Invoke-BackupDrill }
  "seed-staging"       { Invoke-SeedStaging }
  "dashboard"         { Invoke-Dashboard }
  "dashboard-stop"    { Invoke-DashboardStop }
  default      { Write-Err "Lệnh không hợp lệ: $Command"; Show-Help; exit 1 }
}
