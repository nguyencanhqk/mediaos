# 01-setup-env.ps1 — sinh .env prod (root) + secret ngẫu nhiên + KEK local. An toàn idempotent (-Force để ghi đè).
#   Mặc định domain funtimemediacorp.com, company slug 'funtime'. Mật khẩu super-admin in ra MÀN HÌNH — LƯU LẠI.
param(
  [string]$Domain = "funtimemediacorp.com",
  [string]$CompanySlug = "funtime",
  [string]$AdminEmail = "",
  [switch]$Force
)
. "$PSScriptRoot\_lib.ps1"
if (-not $AdminEmail) { $AdminEmail = "admin@$Domain" }

Write-Step "01 — Tạo .env prod cho $Domain"

if ((Test-Path $EnvPath) -and -not $Force) {
  $bak = "$EnvPath.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  Copy-Item $EnvPath $bak
  Write-Warn ".env đã tồn tại → backup $bak. Dùng -Force để ghi đè (đang DỪNG để bạn xem)."
  return
}

# ── Secrets ──────────────────────────────────────────────────────────────
$ownerPw   = New-Secret 24
$appPw     = New-Secret 24
$workerPw  = New-Secret 24
$pgbAuthPw = New-Secret 24
$minioPw   = New-Secret 24
$s3Secret  = New-Secret 24
$jwtSecret = New-HexSecret 32
$adminPw   = New-Secret 18

$kekPath = Join-Path $RepoRoot ".secrets\local-kek.bin"

# ── Origin lists ─────────────────────────────────────────────────────────
# Kiến trúc 3 FE app: apps/app phục vụ ở APEX ($Domain) · auth.$Domain · console.$Domain.
# (de-media-fy: bỏ studio/people/web cũ.) $subApps = app subdomain NGOÀI auth (app ở apex).
$subApps = @("console")
$cors = @("https://$Domain", "https://auth.$Domain") + ($subApps | ForEach-Object { "https://$_.$Domain" })
# redirect allowlist = nơi auth bounce về sau đăng nhập = apex (app shell) + console.
$redirect = @("https://$Domain") + ($subApps | ForEach-Object { "https://$_.$Domain" })
$CORS = ($cors -join ",")
$REDIRECT = ($redirect -join ",")

$env_content = @"
# MediaOS .env PROD — sinh bởi scripts/windows/01-setup-env.ps1. KHÔNG commit (đã gitignore).
NODE_ENV=production
API_PORT=3100
API_PREFIX=api
API_VERSION=v1

# ── Postgres + 3 role tách quyền (G2-1) ──
POSTGRES_USER=mediaos
POSTGRES_PASSWORD=$ownerPw
POSTGRES_DB=mediaos
POSTGRES_PORT=5432
PGBOUNCER_PORT=6432
# ⚠️ DATABASE_URL trỏ THẲNG Postgres :5432 (KHÔNG qua PgBouncer :6432). Lý do: edoburu/pgbouncer
# tự sinh '[databases] mediaos = ... auth_user=postgres' nhưng KHÔNG có role 'postgres' (superuser=mediaos)
# và userlist.txt chỉ chứa pgbouncer_auth → auth_query fail → 'Connection terminated unexpectedly'.
# RLS VẪN ÉP: app nối bằng mediaos_app (không BYPASSRLS) + set_config('app.current_company_id',$1,true)
# trong transaction (withTenant). PgBouncer pooling là TODO khi auth_query được wire đúng (custom config:
# db-line auth_user=pgbouncer_auth, KHÔNG đặt user=). Verify foreground 2026-06-18: login + /health/db OK.
DATABASE_URL=postgres://mediaos_app:$appPw@localhost:5432/mediaos
DATABASE_DIRECT_URL=postgres://mediaos:$ownerPw@localhost:5432/mediaos
DATABASE_WORKER_URL=postgres://mediaos_worker:$workerPw@localhost:5432/mediaos
APP_DB_PASSWORD=$appPw
WORKER_DB_PASSWORD=$workerPw
PGBOUNCER_AUTH_PASSWORD=$pgbAuthPw

# ── Valkey ──
VALKEY_PORT=6379
VALKEY_URL=redis://localhost:6379

# ── Object storage (MinIO tự host; đổi sang R2 nếu muốn — xem cloudflare-deploy-guide §2b) ──
MINIO_ROOT_USER=mediaos
MINIO_ROOT_PASSWORD=$minioPw
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=mediaos
S3_SECRET_KEY=$minioPw
S3_BUCKET=mediaos-assets
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

# ── JWT (bắt buộc) ──
JWT_SECRET=$jwtSecret

# ── KMS (local KEK — lệch ADR-0004, dùng tạm khi Vault provider còn stub; xem guide §2a) ──
KMS_PROVIDER=local
KMS_LOCAL_KEK_PATH=$kekPath

# ── Worker scheduler ──
WORKERS_SCHEDULER_ENABLED=true
OUTBOX_POLL_MS=5000
EXPORT_POLL_MS=10000

# ── SSO cookie PROD (đầu '.' bắt buộc; Secure cần HTTPS edge — Cloudflare lo) ──
AUTH_COOKIE_DOMAIN=.$Domain
AUTH_COOKIE_SECURE=true
CORS_ORIGIN=$CORS
AUTH_REDIRECT_ALLOWLIST=$REDIRECT

# ── Admin seed (apps/api/seed-admin.mjs — chạy qua `m deploy-seed` SAU db:migrate, KHÔNG seed lúc boot) ──
ADMIN_COMPANY_SLUG=$CompanySlug
ADMIN_COMPANY_NAME=$CompanySlug
ADMIN_EMAIL=$AdminEmail
ADMIN_PASSWORD=$adminPw
ADMIN_NAME=Administrator
# 2FA tắt cho lần login đầu (admin chưa enroll TOTP) — bật lại =true sau khi enroll:
TWO_FACTOR_ENFORCEMENT_ENABLED=false

# ── Backup (G1-8) ──
BACKUP_DIR=./backups
BACKUP_RETENTION_DAILY=7
"@

Write-TextFile -Path $EnvPath -Content $env_content
Write-Ok "Ghi $EnvPath"

# ── KEK local 32 byte ──
if ((Test-Path $kekPath) -and -not $Force) {
  Write-Warn "KEK đã tồn tại ($kekPath) — GIỮ NGUYÊN (đổi KEK = mất secret cũ)."
} else {
  $kek = New-Object 'System.Byte[]' 32
  (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($kek)
  $kdir = Split-Path -Parent $kekPath
  if (-not (Test-Path $kdir)) { New-Item -ItemType Directory -Force -Path $kdir | Out-Null }
  [System.IO.File]::WriteAllBytes($kekPath, $kek)
  Write-Ok "Tạo KEK $kekPath (BACKUP file này TÁCH BIỆT — mất = mất mọi secret mã hoá)."
}

Write-Host "`n--------------------------------------------------------------" -ForegroundColor Magenta
Write-Host " ADMIN (LƯU NGAY — không in lại; seed bằng 'm deploy-seed' sau migrate):" -ForegroundColor Magenta
Write-Host ("   email:    " + $AdminEmail)
Write-Host ("   password: " + $adminPw)
Write-Host ("   company:  " + $CompanySlug)
Write-Host "--------------------------------------------------------------`n" -ForegroundColor Magenta
Write-Ok "01 xong. Tiếp: 02-infra-up.ps1"
