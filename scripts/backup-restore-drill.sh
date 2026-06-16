#!/usr/bin/env bash
# backup-restore-drill.sh — G16-2: chứng minh backup KHÔI PHỤC ĐƯỢC (không chỉ chạy được).
#
# Tinh thần ecc:canary-watch cho lớp DB: dump → restore vào DB TẠM → verify chuỗi migration +
# schema (bảng/RLS/index) → smoke check → tự dọn. Backup không restore-test = không phải backup.
#
# Bổ trợ scripts/backup-db.sh (script đó lo dump→encrypt→offsite; script NÀY lo verify-restore).
# An toàn: KHÔNG đụng DB nguồn (chỉ pg_dump read-only); DB tạm tên ngẫu nhiên, DROP ở cuối (trap).
#
# Cấu hình qua biến môi trường:
#   DATABASE_DIRECT_URL  postgres://user:pass@host:port/dbname (DIRECT, không qua PgBouncer) [BẮT BUỘC]
#   DUMP_FILE            dùng lại 1 dump có sẵn thay vì dump mới (tuỳ chọn; .dump custom-format)
#   EXPECTED_MIGRATIONS  số migration kỳ vọng trong drizzle.__drizzle_migrations (tuỳ chọn; mặc định = đếm file journal)
#   KEEP_TEMP            =1 để GIỮ DB tạm sau drill (debug). Mặc định DROP.
#
# Exit 0 = drill PASS (restore + verify + smoke đều xanh). Khác 0 = FAIL (in lý do).

set -Eeuo pipefail

log()  { printf '[drill %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "FAIL: $*" >&2; exit 1; }
ok()   { log "OK: $*"; }

: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required}"

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found (cài postgresql-client)"
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not found"
command -v psql >/dev/null 2>&1 || fail "psql not found"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="$SCRIPT_DIR/../apps/api/migrations"

# ── Phân giải URL nguồn → URL cho DB tạm (cùng host/cred, đổi tên db) ──
# postgres://user:pass@host:port/dbname[?...]  → tách phần trước '/dbname'
SRC_URL="$DATABASE_DIRECT_URL"
BASE_URL="${SRC_URL%/*}"                       # postgres://user:pass@host:port
SRC_DB_AND_QS="${SRC_URL##*/}"                 # dbname?query
SRC_DB="${SRC_DB_AND_QS%%\?*}"
QS=""
[[ "$SRC_DB_AND_QS" == *\?* ]] && QS="?${SRC_DB_AND_QS#*\?}"

STAMP="$(date -u +%Y%m%d%H%M%S)"
TMP_DB="mediaos_drill_${STAMP}_$$"
ADMIN_URL="${BASE_URL}/postgres${QS}"          # kết nối 'postgres' để CREATE/DROP db tạm
TMP_URL="${BASE_URL}/${TMP_DB}${QS}"

cleanup() {
  local code=$?
  [[ -n "${DUMP_TMP:-}" && -f "${DUMP_TMP:-}" ]] && rm -f "$DUMP_TMP"
  if [[ "${KEEP_TEMP:-0}" != "1" ]]; then
    log "cleanup: DROP DATABASE $TMP_DB"
    psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -q \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TMP_DB' AND pid<>pg_backend_pid();" \
      -c "DROP DATABASE IF EXISTS \"$TMP_DB\";" >/dev/null 2>&1 || log "WARN: drop temp db lỗi (dọn tay nếu cần)"
  else
    log "KEEP_TEMP=1 → GIỮ $TMP_DB (nhớ DROP tay)"
  fi
  exit "$code"
}
trap cleanup EXIT

# ── 1) DUMP (hoặc dùng lại DUMP_FILE) ──
if [[ -n "${DUMP_FILE:-}" ]]; then
  [[ -f "$DUMP_FILE" ]] || fail "DUMP_FILE không tồn tại: $DUMP_FILE"
  DUMP="$DUMP_FILE"
  log "1/5 dùng dump có sẵn: $DUMP"
else
  DUMP_TMP="$(mktemp -t mediaos-drill-XXXXXX.dump)"
  DUMP="$DUMP_TMP"
  log "1/5 pg_dump (read-only, custom-format) → $DUMP"
  pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$SRC_URL" \
    || fail "pg_dump nguồn lỗi"
fi
ok "dump sẵn sàng ($(du -h "$DUMP" | cut -f1))"

# ── 2) CREATE DB tạm + RESTORE ──
log "2/5 CREATE DATABASE $TMP_DB"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$TMP_DB\";" \
  || fail "không tạo được DB tạm"
log "2/5 pg_restore → $TMP_DB"
# --no-owner/--no-privileges: roles (mediaos_app/worker) có thể khác giữa máy; verify schema không cần role match.
# Cho phép cảnh báo non-fatal (vd ALTER ROLE) nhưng bắt lỗi nghiêm trọng qua kiểm schema bên dưới.
pg_restore --no-owner --no-privileges --dbname="$TMP_URL" "$DUMP" \
  || log "WARN: pg_restore trả non-zero (thường do GRANT role vắng — verify schema bên dưới quyết định PASS/FAIL)"
ok "restore xong"

# ── 3) VERIFY chuỗi migration ──
log "3/5 verify chuỗi migration (drizzle.__drizzle_migrations)"
APPLIED="$(psql "$TMP_URL" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations;" 2>/dev/null || echo "ERR")"
[[ "$APPLIED" == "ERR" ]] && fail "không đọc được drizzle.__drizzle_migrations (restore hỏng?)"
JOURNAL_COUNT="$(grep -c '"idx"' "$MIG_DIR/meta/_journal.json" 2>/dev/null || echo 0)"
EXPECTED="${EXPECTED_MIGRATIONS:-$JOURNAL_COUNT}"
log "    applied=$APPLIED  journal=$JOURNAL_COUNT  expected=$EXPECTED"
[[ "$APPLIED" -ge "$EXPECTED" && "$EXPECTED" -gt 0 ]] \
  || fail "số migration applied ($APPLIED) < kỳ vọng ($EXPECTED) — chuỗi không đầy đủ"
ok "chuỗi migration đủ ($APPLIED ≥ $EXPECTED)"

# ── 4) VERIFY schema: bảng cốt lõi + RLS FORCE + index G16-2 ──
log "4/5 verify schema (bảng cốt lõi, RLS, index hot-path)"
CORE_TABLES="companies users tasks notifications attendance_records leave_requests cost_allocations payslips audit_logs"
for tbl in $CORE_TABLES; do
  EXISTS="$(psql "$TMP_URL" -tAc "SELECT to_regclass('public.$tbl') IS NOT NULL;" 2>/dev/null)"
  [[ "$EXISTS" == "t" ]] || fail "thiếu bảng cốt lõi: $tbl"
done
ok "bảng cốt lõi đầy đủ ($CORE_TABLES)"

# RLS FORCE phải còn trên bảng đa-tenant (BẤT BIẾN #1) — restore không được làm rớt
RLS_OFF="$(psql "$TMP_URL" -tAc \
  "SELECT count(*) FROM pg_class WHERE relname IN ('tasks','notifications','payslips','users') AND NOT relrowsecurity;" 2>/dev/null)"
[[ "$RLS_OFF" == "0" ]] || fail "RLS không bật trên $RLS_OFF bảng đa-tenant sau restore"
ok "RLS bật trên bảng đa-tenant"

# Index G16-2 phải hiện diện (migration 0220 đã restore)
for idx in tasks_company_created_active_idx tasks_company_status_active_idx notifications_company_user_created_idx; do
  HAS="$(psql "$TMP_URL" -tAc "SELECT count(*) FROM pg_indexes WHERE indexname='$idx';" 2>/dev/null)"
  [[ "$HAS" == "1" ]] || fail "thiếu index hot-path: $idx"
done
ok "index hot-path G16-2 hiện diện"

# ── 5) SMOKE: query đọc cơ bản chạy được (schema dùng được, không chỉ tồn tại) ──
log "5/5 smoke check (read query trên schema khôi phục)"
psql "$TMP_URL" -v ON_ERROR_STOP=1 -tAc \
  "SELECT count(*) FROM companies;
   SELECT count(*) FROM users;
   SELECT count(*) FROM tasks;" >/dev/null \
  || fail "smoke read query lỗi"
ok "smoke read query chạy được"

log "DRILL PASS ✅ — backup KHÔI PHỤC ĐƯỢC (restore + verify migration/schema/RLS/index + smoke đều xanh)"
