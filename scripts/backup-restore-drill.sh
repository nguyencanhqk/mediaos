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
  if [[ -n "${DUMP_TMP:-}" && -f "${DUMP_TMP:-}" ]]; then
    rm -f "$DUMP_TMP" || log "WARN: không xóa được dump tạm $DUMP_TMP (xóa tay)"
  fi
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
# pg_restore trả non-zero cho CẢ cảnh báo role/owner vắng (vô hại) LẪN lỗi schema thật (type/index/policy
# hỏng). KHÔNG nuốt mù: bắt stderr, chỉ tha dòng role/grant/owner đã biết; còn lỗi/cảnh báo nào khác →
# FAIL ngay (đừng để restore vỡ một phần lọt xuống verify rồi PASS giả vì verify không phủ hết object).
RESTORE_ERR="$(mktemp -t mediaos-drill-restore-XXXXXX.log)"
pg_restore --no-owner --no-privileges --dbname="$TMP_URL" "$DUMP" 2>"$RESTORE_ERR" || true
SERIOUS="$(grep -iE 'error|warning' "$RESTORE_ERR" \
  | grep -ivE 'role|grant|privileg|owner|membership' || true)"
rm -f "$RESTORE_ERR" 2>/dev/null || true
if [[ -n "$SERIOUS" ]]; then
  log "pg_restore lỗi nghiêm trọng (không chỉ role/grant):" >&2
  printf '  %s\n' "$SERIOUS" >&2
  fail "restore không sạch — xem lỗi trên (restore vỡ một phần)"
fi
ok "restore xong (không lỗi ngoài role/grant)"

# ── 3) VERIFY chuỗi migration ──
log "3/5 verify chuỗi migration (drizzle.__drizzle_migrations)"
APPLIED="$(psql "$TMP_URL" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations;" 2>/dev/null || echo "ERR")"
[[ "$APPLIED" == "ERR" ]] && fail "không đọc được drizzle.__drizzle_migrations (restore hỏng?)"
JOURNAL_COUNT="$(grep -c '"idx"' "$MIG_DIR/meta/_journal.json" 2>/dev/null || echo 0)"
EXPECTED="${EXPECTED_MIGRATIONS:-$JOURNAL_COUNT}"
log "    applied=$APPLIED  journal=$JOURNAL_COUNT  expected=$EXPECTED"
[[ "$APPLIED" -ge "$EXPECTED" && "$EXPECTED" -gt 0 ]] \
  || fail "số migration applied ($APPLIED) < kỳ vọng ($EXPECTED) — chuỗi không đầy đủ"
# Cảnh báo (không fail) nếu dump có NHIỀU migration hơn journal hiện tại → dump từ codebase/epoch khác.
[[ -z "${EXPECTED_MIGRATIONS:-}" && "$APPLIED" -gt "$JOURNAL_COUNT" ]] \
  && log "WARN: applied ($APPLIED) > journal ($JOURNAL_COUNT) — dump có thể từ codebase mới hơn (kiểm DUMP_FILE)"
ok "chuỗi migration đủ ($APPLIED ≥ $EXPECTED)"

# ── 4) VERIFY schema: bảng cốt lõi + RLS FORCE + index G16-2 ──
log "4/5 verify schema (bảng cốt lõi, RLS, index hot-path)"
CORE_TABLES="companies users tasks notifications attendance_records leave_requests cost_allocations payslips audit_logs"
for tbl in $CORE_TABLES; do
  EXISTS="$(psql "$TMP_URL" -tAc "SELECT to_regclass('public.$tbl') IS NOT NULL;" 2>/dev/null)"
  [[ "$EXISTS" == "t" ]] || fail "thiếu bảng cốt lõi: $tbl"
done
ok "bảng cốt lõi đầy đủ ($CORE_TABLES)"

# RLS phải còn BẬT trên bảng đa-tenant (BẤT BIẾN #1) — restore không được làm rớt
RLS_OFF="$(psql "$TMP_URL" -tAc \
  "SELECT count(*) FROM pg_class WHERE relname IN ('tasks','notifications','payslips','users') AND NOT relrowsecurity;" 2>/dev/null)"
[[ "$RLS_OFF" == "0" ]] || fail "RLS không bật trên $RLS_OFF bảng đa-tenant sau restore"
# FORCE RLS (BẤT BIẾN #1): relrowsecurity (bật) CHƯA đủ — phải relforcerowsecurity để RLS áp CẢ owner.
# Nếu restore làm rớt FORCE, một superuser/owner đọc xuyên tenant mà drill vẫn PASS nếu chỉ kiểm 'bật'.
RLS_NOTFORCED="$(psql "$TMP_URL" -tAc \
  "SELECT count(*) FROM pg_class WHERE relname IN ('tasks','notifications','payslips','users') AND NOT relforcerowsecurity;" 2>/dev/null)"
[[ "$RLS_NOTFORCED" == "0" ]] || fail "FORCE RLS rớt trên $RLS_NOTFORCED bảng đa-tenant sau restore"
# Policy phải còn: CREATE POLICY có thể fail âm thầm lúc restore (tham chiếu hàm thiếu). Đếm pg_policies
# TRỰC TIẾP — bắt 'policy rớt' kể cả khi smoke chạy bằng superuser (superuser bypass RLS nên read-smoke
# KHÔNG lộ policy hỏng; kiểm cấu trúc mới chắc).
POL_MISSING="$(psql "$TMP_URL" -tAc \
  "SELECT count(*) FROM (VALUES ('tasks'),('notifications'),('payslips'),('users')) t(rel)
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = t.rel);" 2>/dev/null)"
[[ "$POL_MISSING" == "0" ]] || fail "thiếu RLS policy trên $POL_MISSING bảng đa-tenant sau restore"
ok "RLS bật + FORCE + policy hiện diện trên bảng đa-tenant"

# Index G16-2 phải hiện diện (migration 0220 đã restore) — cả 4 index hot-path
for idx in tasks_company_created_active_idx tasks_company_assignee_active_idx tasks_company_status_active_idx notifications_company_user_created_idx; do
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
# Smoke qua đường tenant-GUC: set app.current_company_id rồi đọc — chứng minh GUC + đường đọc dùng được
# sau restore (hàm/policy tham chiếu current_setting không vỡ ở mức query). UUID giả → kỳ vọng chạy không lỗi.
# (Enforcement THẬT của policy đã được kiểm cấu trúc ở bước 4 qua pg_policies — superuser bypass RLS nên
#  bước này KHÔNG khẳng định lọc, chỉ khẳng định query-path chạy.)
psql "$TMP_URL" -v ON_ERROR_STOP=1 -tAc \
  "SET app.current_company_id = '00000000-0000-0000-0000-000000000000';
   SELECT count(*) FROM tasks;
   SELECT count(*) FROM payslips;" >/dev/null \
  || fail "smoke tenant-GUC read lỗi (đường đọc/hàm policy có thể không khôi phục được)"
ok "smoke read (cơ bản + tenant-GUC) chạy được"

log "DRILL PASS ✅ — backup KHÔI PHỤC ĐƯỢC (restore + verify migration/schema/RLS/index + smoke đều xanh)"
