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
# Đọc DB đích từ .env đang active, CHE mật khẩu. `pnpm db:migrate` im lặng đi theo .env hiện tại —
# .env bị hoán đổi giữa prod/dev-online nên rất dễ migrate nhầm DB mà không hay.
function Get-MigrateTarget {
  $envPath = Join-Path $Root ".env"
  if (-not (Test-Path $envPath)) { return "(KHÔNG có .env — chạy 'm prod-env' hoặc copy .env.example)" }
  $line = Select-String -Path $envPath -Pattern '^\s*DATABASE_DIRECT_URL\s*=' | Select-Object -First 1
  if (-not $line) { return "(.env THIẾU DATABASE_DIRECT_URL)" }
  $url = ($line.Line -split '=', 2)[1].Trim().Trim('"').Trim("'")
  return ($url -replace '://([^:]+):[^@]+@', '://$1:***@')
}

function Invoke-Migrate {
  Write-Step "Migrate DB"
  Write-Host ("  .env dang dung : " + (Get-ActiveEnv))
  Write-Host ("  DB dich        : " + (Get-MigrateTarget))
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
# Cả hai lệnh CHỈ dành cho cluster dev/dev-online cục bộ. GUARD kép: (1) chặn khi .env active = prod;
# (2) seed-staging chỉ chấp nhận DB đích mediaos_dev. KHÔNG rebuild dist mà PROD service đang chạy
# (landmine prod-dist-shared) — chỉ gọi bash/node script có sẵn.

# Chứng minh migrate-from-empty (0000→head) trên DB ephemeral mediaos_migverify_* — tự DROP ở trap EXIT,
# KHÔNG chạm mediaos/mediaos_dev. Host Windows không có psql → fallback psql TRONG container qua
# MIGVERIFY_PSQL (script chỉ đổi cách gọi psql, guard/URL giữ nguyên).
function Invoke-MigrateVerify {
  Write-Step "MIGRATE-VERIFY — migrate-from-empty trên DB ephemeral (tự DROP, không chạm mediaos/mediaos_dev)"
  if ((Get-ActiveEnv) -eq ".env.prod") {
    Write-Err "GUARD: .env active = .env.prod — từ chối. Chuyển env dev trước ('m dev' hoặc dev-online)."
    exit 1
  }
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

# Seed 4 tài khoản UAT (Employee/Manager/HR/company-admin) lên mediaos_dev — idempotent, non-destructive.
# Cred đọc từ STAGING_SEED_* trong .env.dev-online (script fail-fast ≥12 ký tự TRƯỚC khi ghi DB,
# không log mật khẩu). Super Admin KHÔNG seed ở đây — qua PLATFORM_SUPERADMIN_* lúc boot API.
function Invoke-SeedStaging {
  Write-Step "SEED-STAGING — 4 tài khoản UAT (Employee/Manager/HR/company-admin) lên mediaos_dev"
  if ((Get-ActiveEnv) -eq ".env.prod") {
    Write-Err "GUARD: .env active = .env.prod — từ chối seed staging từ env prod."
    exit 1
  }
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
  Write-Host "    dev-online-fast     như dev-online nhưng API + 3 SPA đều chạy BẢN BUILD (nhanh/ổn định qua tunnel, không watch/HMR)"
  Write-Host "    dev-online-stop     dừng dev-online (giải phóng cổng 3200/5273/5275/5278)"
  Write-Host "    dev-online-logs     xem/tail log tiến trình ẩn (dev\logs\; vd: m dev-online-logs api)"
  Write-Host "    dev-online-db       tạo + migrate + SEED LẠI DB cô lập mediaos_dev (1 lần)"
  Write-Host "    dev-online-migrate  CHỈ migrate mediaos_dev (không tạo DB, không seed lại)"
  Write-Host "    dev-online-tunnel   tạo ingress cloudflared + DNS cho cian-dev.* (1 lần, Administrator)"
  Write-Host ""
  Write-Host "  STAGING / UAT (S5-DEVOPS-1 — chỉ cluster dev cục bộ, chặn .env=prod)" -ForegroundColor Yellow
  Write-Host "    migrate-verify      chứng minh migrate-from-empty (0000→head) trên DB ephemeral tự DROP"
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
    Write-Host "   [8] Sync DB roles -> dev  (khi login báo sai mật khẩu)"
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
    Write-Host "  --- DASHBOARD tiến độ (chạy ẩn, cổng 5180) ---" -ForegroundColor DarkCyan
    Write-Host "  [16] Bật DASHBOARD (ẩn)    http://localhost:5180"
    Write-Host "  [17] Tắt DASHBOARD"
    Write-Host "   [0] Thoát"
    Write-Host ""
    $choice = Read-Host "Chọn (0-20)"
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
  "dev-online-logs"   { Invoke-DevOnlineLogs $Rest }
  "dev-online-db"      { Invoke-DevOnlineDb }
  "dev-online-migrate" { Invoke-DevOnlineMigrate }
  "dev-online-tunnel"  { Invoke-DevOnlineTunnel }
  "migrate-verify"     { Invoke-MigrateVerify }
  "seed-staging"       { Invoke-SeedStaging }
  "dashboard"         { Invoke-Dashboard }
  "dashboard-stop"    { Invoke-DashboardStop }
  default      { Write-Err "Lệnh không hợp lệ: $Command"; Show-Help; exit 1 }
}
