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
#   BACKUP_PG_DUMP        lệnh pg_dump thay thế khi host không có pg client trên PATH (S6-GOLIVE-1).
#   BACKUP_PG_CONTAINER   tên container Postgres dùng cho auto-fallback (mặc định mediaos-postgres).
#
# Cron gợi ý (02:00 Asia/Ho_Chi_Minh): 0 19 * * * (UTC) /path/scripts/backup-db.sh

set -Eeuo pipefail

log()  { printf '[backup %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

# ── S6-GOLIVE-1 (LỖ-1): pg client trong CONTAINER khi host không có trên PATH ────────────────
# Bối cảnh: từ khi Postgres vào docker, máy PROD-host (Windows) KHÔNG có pg_dump trên PATH ⇒ script
# này fail ngay dòng `command -v pg_dump` ⇒ backup CHƯA TỪNG chạy được trên chính máy nó phải bảo vệ
# (KI-050). migrate-verify-ephemeral.sh đã giải bài này bằng MIGVERIFY_PSQL, backup-restore-drill.sh
# theo sau ở S6-PERF-DB-1 — backup-db.sh lỡ CẢ HAI đợt. Ở đây dùng đúng khuôn đó.
#
# Thứ tự ưu tiên: env tường minh (BACKUP_PG_DUMP) → binary trên PATH → docker exec vào container.
# ⚠️ Fallback container CHỈ kích hoạt khi PATH TRƯỢT. Máy/CI có pg client thật ⇒ đi đường cũ, không
#    đổi một byte hành vi (R1 trong docs/plans/S6-GOLIVE-1.md).
BACKUP_PG_CONTAINER="${BACKUP_PG_CONTAINER:-mediaos-postgres}"

_have_container() {
  command -v docker >/dev/null 2>&1 || return 1
  # So khớp TÊN CHÍNH XÁC. KHÔNG dùng `--filter name=^/x$`: dạng anchor có/không '/' đầu khác nhau
  # giữa các bản Docker ⇒ fallback im lặng không kích hoạt và backup fail oan.
  docker ps --filter "status=running" --format '{{.Names}}' 2>/dev/null \
    | grep -qx -- "$BACKUP_PG_CONTAINER"
}

resolve_pg_dump() {
  if [[ -n "${BACKUP_PG_DUMP:-}" ]]; then return 0; fi              # người gọi đã khai tường minh
  if command -v pg_dump >/dev/null 2>&1; then BACKUP_PG_DUMP="pg_dump"; return 0; fi
  if _have_container; then BACKUP_PG_DUMP="docker exec -i $BACKUP_PG_CONTAINER pg_dump"; return 0; fi
  # R3: KHÔNG skip im lặng. Backup không chạy được thì KHÔNG được coi là đã backup.
  fail "pg_dump không có trên PATH và container '$BACKUP_PG_CONTAINER' không chạy — cài postgresql-client hoặc bật container"
}

# Gọi qua hàm (KHÔNG quote cả chuỗi) để "docker exec -i ct pg_dump" tách thành nhiều từ đúng cách.
PG_DUMP() { $BACKUP_PG_DUMP "$@"; }

# Cờ dump dùng chung cho cả đường chạy thật lẫn --print-plan (một nguồn sự thật để test soi được).
# ⚠️ R2: KHÔNG có `--file`. Khi pg_dump chạy qua `docker exec`, `--file` ghi vào filesystem CỦA
# CONTAINER ⇒ script báo DONE mà host không có file nào (bẫy đã ghi ở backup-restore-drill.sh:157).
# Ghi qua STDOUT rồi redirect ở host — kết quả giống hệt nhau ở cả hai đường.
PG_DUMP_FLAGS=(--format=custom --no-owner --no-privileges)

# ── --print-plan: in cách gọi đã phân giải rồi thoát. KHÔNG chạm Postgres, KHÔNG ghi file. ────
# Cho phép test khẳng định R1/R2/R3 mà không cần DB (khuôn --self-test của backup-restore-drill.sh).
if [[ "${1:-}" == "--print-plan" ]]; then
  resolve_pg_dump
  printf 'pg_dump=%s\n'   "$BACKUP_PG_DUMP"
  printf 'flags=%s\n'     "${PG_DUMP_FLAGS[*]}"
  printf 'container=%s\n' "$BACKUP_PG_CONTAINER"
  exit 0
fi

: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"

resolve_pg_dump
log "pg client: pg_dump='$BACKUP_PG_DUMP'"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BASE="$BACKUP_DIR/mediaos-$STAMP.dump"

# 1) Dump custom-format (-Fc) → đã nén sẵn, restore chọn lọc được. Ghi qua STDOUT (xem R2).
log "pg_dump → $BASE"
PG_DUMP "${PG_DUMP_FLAGS[@]}" "$DATABASE_DIRECT_URL" > "$BASE" \
  || { rm -f "$BASE"; fail "pg_dump failed"; }

# Redirect tạo file TRƯỚC khi pg_dump chạy ⇒ lỗi giữa chừng để lại file cụt. Một dump cụt còn nguy
# hiểm hơn không có dump: nó làm ô "tuổi bản backup" xanh trong khi không khôi phục được gì.
DUMP_BYTES="$(wc -c < "$BASE" | tr -d ' ')"
[[ "$DUMP_BYTES" -gt 1024 ]] \
  || { rm -f "$BASE"; fail "dump chỉ $DUMP_BYTES byte — coi như hỏng, đã xoá"; }
log "dump OK — $DUMP_BYTES byte"

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
