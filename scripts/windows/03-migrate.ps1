# 03-migrate.ps1 — install deps + build contracts + migrate DB + gán mật khẩu role. Chạy sau 02-infra-up.ps1.
. "$PSScriptRoot\_lib.ps1"

Write-Step "03 — Install + Migrate + DB roles"
Assert-Command pnpm "Bật corepack/pnpm (00-prereqs.ps1)."
Import-DotEnv   # nạp .env vào session → pnpm con kế thừa DATABASE_*/APP_DB_PASSWORD...

Push-Location $RepoRoot
try {
  Write-Host "  pnpm install ..."
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "pnpm install thất bại." }

  Write-Host "  build @mediaos/contracts ..."
  pnpm --filter "@mediaos/contracts" build
  if ($LASTEXITCODE -ne 0) { throw "build contracts thất bại." }

  Write-Host "  db:migrate (qua DATABASE_DIRECT_URL) ..."
  pnpm db:migrate
  if ($LASTEXITCODE -ne 0) { throw "db:migrate thất bại." }

  Write-Host "  db:setup-roles (gán mật khẩu mediaos_app/worker + userlist.txt) ..."
  pnpm db:setup-roles
  if ($LASTEXITCODE -ne 0) { throw "db:setup-roles thất bại." }

  Write-Host "  restart pgbouncer (nạp userlist.txt) ..."
  docker compose restart pgbouncer | Out-Null
}
finally { Pop-Location }

Write-Ok "03 xong (schema + RLS + role sẵn sàng)."
Write-Warn "TIẾP THEO — seed company đầu tiên (CHƯA tự động, cần xác nhận schema):"
Write-Host  "  1) Kiểm cột bảng companies: apps/api/src/db/schema/  (có thể có cột NOT NULL khác)"
Write-Host  "  2) psql `"`$env:DATABASE_DIRECT_URL`" rồi:"
Write-Host  "       INSERT INTO companies (id,name,slug,status)"
Write-Host  "       VALUES (gen_random_uuid(),'Funtime Media Corp','funtime','active');"
Write-Host  "  3) Sau khi service API chạy (04), super-admin tự tạo từ PLATFORM_SUPERADMIN_* (idempotent;"
Write-Host  "     nếu company chưa có lúc boot → bootstrap bỏ qua → restart service sau khi seed)."
Write-Ok    "Tiếp: 04-build-install-service.ps1"
