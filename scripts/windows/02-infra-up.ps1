# 02-infra-up.ps1 — dựng hạ tầng docker (postgres/pgbouncer/valkey/minio) + chờ healthy + tạo bucket.
#   Yêu cầu: Docker Desktop ĐANG CHẠY ('Engine running'). Chạy sau 01-setup-env.ps1.
. "$PSScriptRoot\_lib.ps1"

Write-Step "02 — Hạ tầng Docker"
Assert-Command docker "Cài Docker Desktop (00-prereqs.ps1) và mở app."
if (-not (Test-Path $EnvPath)) { throw "Chưa có .env — chạy 01-setup-env.ps1 trước." }

Push-Location $RepoRoot
try {
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw "docker compose up thất bại (Docker Desktop đã chạy chưa?)." }

  Write-Host "  chờ Postgres healthy ..."
  $ok = $false
  for ($i = 0; $i -lt 60; $i++) {
    $s = (docker inspect -f "{{.State.Health.Status}}" mediaos-postgres 2>$null)
    if ($s -eq "healthy") { $ok = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ok) { throw "Postgres không healthy sau ~120s. Xem 'docker compose logs postgres'." }
  Write-Ok "Postgres healthy"

  # Bucket MinIO (qua mc trên network compose). Bỏ qua nếu dùng R2.
  $mUser = Get-DotEnvValue "MINIO_ROOT_USER"
  $mPass = Get-DotEnvValue "MINIO_ROOT_PASSWORD"
  $bucket = Get-DotEnvValue "S3_BUCKET"
  if ($mUser -and $mPass -and $bucket) {
    Write-Host "  tạo bucket $bucket ..."
    $cmd = "mc alias set m http://minio:9000 $mUser $mPass && mc mb -p m/$bucket && mc anonymous set none m/$bucket && mc ls m"
    docker run --rm --network mediaos_default --entrypoint sh minio/mc -c $cmd
    if ($LASTEXITCODE -ne 0) { Write-Warn "Tạo bucket lỗi (có thể đã tồn tại / network khác 'mediaos_default')." }
    else { Write-Ok "Bucket $bucket sẵn sàng" }
  }
}
finally { Pop-Location }

Write-Ok "02 xong. Tiếp: 03-migrate.ps1"
