#!/usr/bin/env bash
# backup-db.sh — Postgres dump → nén → MÃ HOÁ → đẩy offsite (B2/Drive) + retention GFS.
# Thực thi G1-8 cho chiến lược 3-2-1 ở docs/infra-zero-cost-plan.md §3.
#
# BẤT BIẾN #3: dump chứa secret (đã envelope-encrypt) + PII/payroll → PHẢI mã hoá at-rest
# TRƯỚC khi rời máy chủ; khoá mã hoá KHÔNG lưu cùng chỗ dump (tách khoá khỏi dữ liệu).
#
# Cấu hình qua biến môi trường (xem .env.example):
#   DATABASE_DIRECT_URL   postgres://... (kết nối DIRECT, không qua PgBouncer)
#   BACKUP_DIR            thư mục dump local (mặc định ./backups)
#   BACKUP_GPG_RECIPIENT  email/key-id GPG để mã hoá (BẮT BUỘC để bật mã hoá)
#   BACKUP_B2_REMOTE      rclone remote, vd "b2:mediaos-backup" (tuỳ chọn; bỏ trống = chỉ local)
#   BACKUP_RETENTION_DAILY số bản daily giữ lại (mặc định 7)
#
# Cron gợi ý (02:00 Asia/Ho_Chi_Minh): 0 19 * * * (UTC) /path/scripts/backup-db.sh

set -Eeuo pipefail

log()  { printf '[backup %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found (cài postgresql-client)"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BASE="$BACKUP_DIR/mediaos-$STAMP.dump"

# 1) Dump custom-format (-Fc) → đã nén sẵn, restore chọn lọc được.
log "pg_dump → $BASE"
pg_dump --format=custom --no-owner --no-privileges --file="$BASE" "$DATABASE_DIRECT_URL" \
  || fail "pg_dump failed"

ARTIFACT="$BASE"

# 2) Mã hoá (bắt buộc nếu có recipient). Ưu tiên age, fallback gpg.
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  if command -v age >/dev/null 2>&1; then
    log "age encrypt → $BASE.age"
    age --recipient "$BACKUP_GPG_RECIPIENT" --output "$BASE.age" "$BASE" || fail "age encrypt failed"
    rm -f "$BASE"; ARTIFACT="$BASE.age"
  elif command -v gpg >/dev/null 2>&1; then
    log "gpg encrypt → $BASE.gpg"
    gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$BASE.gpg" "$BASE" \
      || fail "gpg encrypt failed"
    rm -f "$BASE"; ARTIFACT="$BASE.gpg"
  else
    fail "BACKUP_GPG_RECIPIENT đặt nhưng không có age/gpg — dump KHÔNG được rời máy chưa mã hoá"
  fi
else
  log "CẢNH BÁO: chưa đặt BACKUP_GPG_RECIPIENT → dump KHÔNG mã hoá. Chỉ chấp nhận khi test local."
fi

# 3) Đẩy offsite (rclone) nếu cấu hình remote.
if [[ -n "${BACKUP_B2_REMOTE:-}" ]]; then
  command -v rclone >/dev/null 2>&1 || fail "rclone not found nhưng BACKUP_B2_REMOTE đã đặt"
  log "rclone copy → $BACKUP_B2_REMOTE"
  rclone copy "$ARTIFACT" "$BACKUP_B2_REMOTE" --no-traverse || fail "rclone upload failed"
else
  log "BACKUP_B2_REMOTE trống → bỏ qua offsite (chỉ giữ local)."
fi

# 4) Retention local (GFS daily). WAL/PITR + weekly/monthly là nâng cao (xem §3.1).
log "retention: giữ $RETENTION_DAILY dump mới nhất ở local"
ls -1t "$BACKUP_DIR"/mediaos-*.dump* 2>/dev/null | tail -n +"$((RETENTION_DAILY + 1))" | while read -r old; do
  log "xoá dump cũ: $old"
  rm -f "$old"
done

log "DONE → $ARTIFACT"
