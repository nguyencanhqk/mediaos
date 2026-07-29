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
#   DRILL_PSQL           lệnh psql thay thế khi host không có pg client trên PATH (S6-PERF-DB-1).
#   DRILL_PG_DUMP        lệnh pg_dump thay thế — nt.
#   DRILL_PG_RESTORE     lệnh pg_restore thay thế — nt.
#   DRILL_CONTAINER      tên container Postgres dùng cho auto-fallback (mặc định mediaos-postgres).
#
# Exit 0 = drill PASS (restore + verify + smoke đều xanh). Khác 0 = FAIL (in lý do).

set -Eeuo pipefail

log()  { printf '[drill %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "FAIL: $*" >&2; exit 1; }
ok()   { log "OK: $*"; }

# ── GUARD DROP (S6-PERF-DB-1, R1) ────────────────────────────────────────────────────────────
# Trước đây nhánh DROP chỉ dựa vào việc $TMP_DB được sinh cục bộ — đúng trên thực tế nhưng KHÔNG có
# hàng rào tường minh nào chặn nếu biến bị ghi đè do bug/sửa sau này. Trên máy dev này DB nguồn tên
# `mediaos` CHÍNH LÀ DB PROD (company funtime) ⇒ hậu quả của một DROP sai là mất dữ liệu thật.
# Lấy đúng khuôn guard đã dùng ở migrate-verify-ephemeral.sh: prefix bắt buộc + blocklist tường minh.
# Định nghĩa TRƯỚC mọi yêu cầu env/binary để `--self-test` chạy được trên máy trần (không Postgres).
DRILL_DB_PREFIX_RE='^mediaos_drill_[A-Za-z0-9_]+$'
guard_droppable() {
  local db="$1"
  [[ -n "$db" ]]                        || { log "GUARD: REFUSE drop — tên DB rỗng"; return 1; }
  [[ "$db" =~ $DRILL_DB_PREFIX_RE ]]    || { log "GUARD: REFUSE drop — '$db' không khớp prefix bắt buộc ^mediaos_drill_"; return 1; }
  case "$db" in
    mediaos|mediaos_dev|postgres|template0|template1)
      log "GUARD: REFUSE drop — '$db' nằm trong blocklist"; return 1 ;;
  esac
  return 0
}

# ── --self-test: kiểm GUARD bằng logic thuần, KHÔNG chạm Postgres (khuôn migrate-verify) ─────
if [[ "${1:-}" == "--self-test" ]]; then
  log "SELF-TEST: guard refuse-drop (pure logic, không chạm Postgres)"
  st_fail=0
  for bad in "mediaos" "mediaos_dev" "postgres" "" "mediaos_drill" "mediaos_drill_; DROP DATABASE mediaos; --" "template1"; do
    if guard_droppable "$bad"; then log "SELF-TEST FAIL: guard CHO PHÉP tên cấm '$bad'"; st_fail=1
    else ok "guard REFUSE đúng: '$bad'"; fi
  done
  for good in "mediaos_drill_20260729060000_1234" "mediaos_drill_x"; do
    if guard_droppable "$good"; then ok "guard CHO PHÉP đúng: '$good'"
    else log "SELF-TEST FAIL: guard REFUSE tên hợp lệ '$good'"; st_fail=1; fi
  done
  [[ "$st_fail" == "0" ]] || { log "SELF-TEST FAIL" >&2; exit 1; }
  ok "SELF-TEST PASS — guard chặn {mediaos, mediaos_dev, postgres, template*} + mọi tên lạ; chỉ cho phép ^mediaos_drill_"
  exit 0
fi

: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required}"

# ── S6-PERF-DB-1 (LỖ-1): pg client trong CONTAINER khi host không có trên PATH ───────────────
# Bối cảnh: từ khi Postgres chuyển vào docker, máy dev Windows KHÔNG có pg_dump/pg_restore/psql trên
# PATH ⇒ drill fail ngay 3 dòng `command -v` bên dưới ⇒ "backup khôi phục được" thành lời hứa CHƯA
# TỪNG được kiểm. scripts/migrate-verify-ephemeral.sh đã giải đúng bài này bằng MIGVERIFY_PSQL; drill
# lỡ đợt đó. Ở đây làm cùng khuôn, thêm auto-detect.
#
# Thứ tự ưu tiên: env tường minh (DRILL_*) → binary trên PATH → docker exec vào container.
# ⚠️ Fallback container CHỈ kích hoạt khi PATH TRƯỢT. Máy/CI có pg client thật ⇒ đường cũ, không đổi
#    một byte hành vi (R2 trong docs/plans/S6-PERF-DB-1.md).
DRILL_CONTAINER="${DRILL_CONTAINER:-mediaos-postgres}"

_have_container() {
  command -v docker >/dev/null 2>&1 || return 1
  # So khớp TÊN CHÍNH XÁC trên danh sách container đang chạy. KHÔNG dùng `--filter name=^/x$`:
  # dạng anchor có/không dấu '/' đầu khác nhau giữa các bản Docker (bản trên máy này trả RỖNG cho
  # '^/name$' nhưng đúng cho '^name$') ⇒ fallback im lặng không kích hoạt và drill fail oan.
  docker ps --filter "status=running" --format '{{.Names}}' 2>/dev/null \
    | grep -qx -- "$DRILL_CONTAINER"
}

# resolve_tool <tên-biến-env> <tên-binary>: đặt biến env đó thành lệnh chạy được, hoặc fail rõ ràng.
resolve_tool() {
  local var="$1" bin="$2"
  if [[ -n "${!var:-}" ]]; then return 0; fi                       # người gọi đã khai tường minh
  if command -v "$bin" >/dev/null 2>&1; then
    printf -v "$var" '%s' "$bin"
    return 0
  fi
  if _have_container; then
    printf -v "$var" '%s' "docker exec -i $DRILL_CONTAINER $bin"
    return 0
  fi
  fail "$bin không có trên PATH và container '$DRILL_CONTAINER' không chạy — cài postgresql-client hoặc bật container (KHÔNG skip im lặng: drill không chạy được thì không được coi là đã kiểm)"
}

resolve_tool DRILL_PSQL       psql
resolve_tool DRILL_PG_DUMP    pg_dump
resolve_tool DRILL_PG_RESTORE pg_restore

# Gọi qua hàm (KHÔNG quote cả chuỗi) để "docker exec -i ct psql" tách thành nhiều từ đúng cách.
PSQL()       { $DRILL_PSQL "$@"; }
PG_DUMP()    { $DRILL_PG_DUMP "$@"; }
PG_RESTORE() { $DRILL_PG_RESTORE "$@"; }

log "pg client: psql='$DRILL_PSQL' pg_dump='$DRILL_PG_DUMP' pg_restore='$DRILL_PG_RESTORE'"

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
    if guard_droppable "$TMP_DB"; then
      log "cleanup: DROP DATABASE $TMP_DB"
      PSQL "$ADMIN_URL" -v ON_ERROR_STOP=0 -q \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TMP_DB' AND pid<>pg_backend_pid();" \
        -c "DROP DATABASE IF EXISTS \"$TMP_DB\";" >/dev/null 2>&1 || log "WARN: drop temp db lỗi (dọn tay nếu cần)"
    else
      log "WARN: GUARD chặn DROP '$TMP_DB' — KHÔNG xoá gì cả. Dọn tay nếu đây thật sự là DB tạm."
    fi
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
  # Ghi qua STDOUT (không dùng --file): khi pg_dump chạy trong container, --file sẽ ghi vào filesystem
  # CỦA CONTAINER và host nhận file rỗng ⇒ restore "thành công" trên dump rỗng = PASS oan. Stream stdout
  # cho kết quả giống hệt nhau ở cả hai đường (PATH và docker exec).
  PG_DUMP --format=custom --no-owner --no-privileges "$SRC_URL" > "$DUMP" \
    || fail "pg_dump nguồn lỗi"
  [[ -s "$DUMP" ]] || fail "dump RỖNG (0 byte) — pg_dump không ghi được ra host; đừng để restore chạy trên dump rỗng rồi PASS oan"
fi
ok "dump sẵn sàng ($(du -h "$DUMP" | cut -f1))"

# ── 2) CREATE DB tạm + RESTORE ──
log "2/5 CREATE DATABASE $TMP_DB"
PSQL "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$TMP_DB\";" \
  || fail "không tạo được DB tạm"
log "2/5 pg_restore → $TMP_DB"
# --no-owner/--no-privileges: roles (mediaos_app/worker) có thể khác giữa máy; verify schema không cần role match.
# pg_restore trả non-zero cho CẢ cảnh báo role/owner vắng (vô hại) LẪN lỗi schema thật (type/index/policy
# hỏng). KHÔNG nuốt mù: bắt stderr, chỉ tha dòng role/grant/owner đã biết; còn lỗi/cảnh báo nào khác →
# FAIL ngay (đừng để restore vỡ một phần lọt xuống verify rồi PASS giả vì verify không phủ hết object).
RESTORE_ERR="$(mktemp -t mediaos-drill-restore-XXXXXX.log)"
# Đọc dump qua STDIN (không truyền đường dẫn): file nằm trên HOST, còn pg_restore có thể đang chạy
# TRONG container — truyền path sẽ trỏ vào filesystem container và không thấy file. Custom-format
# đọc được từ stream không seek được; đổi lại mất --jobs (không cần cho drill).
PG_RESTORE --no-owner --no-privileges --dbname="$TMP_URL" < "$DUMP" 2>"$RESTORE_ERR" || true
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
APPLIED="$(PSQL "$TMP_URL" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations;" 2>/dev/null || echo "ERR")"
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
# S6-PERF-DB-1 (LỖ-2): danh sách cũ là ảnh chụp KỶ NGUYÊN MEDIA — assert `cost_allocations`/`payslips`
# (đã park, out-of-scope theo CLAUDE.md de-media-fy) trong khi KHÔNG hề assert `employee_profiles`
# (bảng HR canonical), `permissions`/`role_permissions` (thiếu ⇒ user không vào được flow P0 — đúng
# mục cấm IMPLEMENTATION-09 §15.6.3) hay `outbox_events` (event bus, luật phụ thuộc CLAUDE §3).
# Hệ quả HAI CHIỀU: đỏ oan khi dọn bảng park, và PASS oan vì không kiểm RBAC/HR/outbox.
CORE_TABLES="companies users employee_profiles permissions role_permissions tasks notifications attendance_records leave_requests leave_balances outbox_events audit_logs"
for tbl in $CORE_TABLES; do
  EXISTS="$(PSQL "$TMP_URL" -tAc "SELECT to_regclass('public.$tbl') IS NOT NULL;" 2>/dev/null)"
  [[ "$EXISTS" == "t" ]] || fail "thiếu bảng cốt lõi: $tbl"
done
ok "bảng cốt lõi đầy đủ ($CORE_TABLES)"

# RLS phải còn BẬT trên bảng đa-tenant (BẤT BIẾN #1) — restore không được làm rớt.
# `payslips` (park) → thay bằng `employee_profiles`: bảng nhạy cảm THẬT của MVP hiện tại.
RLS_TABLES="'tasks','notifications','employee_profiles','users'"
RLS_OFF="$(PSQL "$TMP_URL" -tAc \
  "SELECT count(*) FROM pg_class WHERE relname IN ($RLS_TABLES) AND NOT relrowsecurity;" 2>/dev/null)"
[[ "$RLS_OFF" == "0" ]] || fail "RLS không bật trên $RLS_OFF bảng đa-tenant sau restore"
# FORCE RLS (BẤT BIẾN #1): relrowsecurity (bật) CHƯA đủ — phải relforcerowsecurity để RLS áp CẢ owner.
# Nếu restore làm rớt FORCE, một superuser/owner đọc xuyên tenant mà drill vẫn PASS nếu chỉ kiểm 'bật'.
RLS_NOTFORCED="$(PSQL "$TMP_URL" -tAc \
  "SELECT count(*) FROM pg_class WHERE relname IN ($RLS_TABLES) AND NOT relforcerowsecurity;" 2>/dev/null)"
[[ "$RLS_NOTFORCED" == "0" ]] || fail "FORCE RLS rớt trên $RLS_NOTFORCED bảng đa-tenant sau restore"
# Policy phải còn: CREATE POLICY có thể fail âm thầm lúc restore (tham chiếu hàm thiếu). Đếm pg_policies
# TRỰC TIẾP — bắt 'policy rớt' kể cả khi smoke chạy bằng superuser (superuser bypass RLS nên read-smoke
# KHÔNG lộ policy hỏng; kiểm cấu trúc mới chắc).
POL_MISSING="$(PSQL "$TMP_URL" -tAc \
  "SELECT count(*) FROM (VALUES ('tasks'),('notifications'),('employee_profiles'),('users')) t(rel)
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = t.rel);" 2>/dev/null)"
[[ "$POL_MISSING" == "0" ]] || fail "thiếu RLS policy trên $POL_MISSING bảng đa-tenant sau restore"
ok "RLS bật + FORCE + policy hiện diện trên bảng đa-tenant"

# BẤT BIẾN #2 (append-only) phải SỐNG SÓT qua restore: pg_dump --no-privileges KHÔNG mang GRANT theo,
# nên đây kiểm ở tầng CẤU TRÚC — bảng ledger phải còn mặt sau restore. Việc REVOKE UPDATE/DELETE cho
# app role là do migration tái lập khi deploy, và đã có chốt riêng ở check-perf-indexes.mjs/CI.
for tbl in audit_logs login_logs attendance_logs leave_balance_transactions task_activity_logs notification_delivery_logs employee_status_histories; do
  EXISTS="$(PSQL "$TMP_URL" -tAc "SELECT to_regclass('public.$tbl') IS NOT NULL;" 2>/dev/null)"
  [[ "$EXISTS" == "t" ]] || fail "thiếu bảng ledger append-only: $tbl"
done
ok "bảng ledger append-only đầy đủ sau restore"

# Index hot-path phải hiện diện sau restore. Nhóm G16-2 (di sản) + nhóm CANONICAL của 4 module MVP
# nặng nhất — nhóm canonical trước nay KHÔNG được canh dù chính nó đỡ các query §14.3.
# ⚠️ CHỈ assert index TỒN TẠI, KHÔNG assert planner chọn nó (bài học pg-planner-index-assert-trap:
#    DB drill vừa restore, dataset nhỏ ⇒ seq scan là lựa chọn HỢP LỆ ⇒ assert EXPLAIN sẽ đỏ oan).
HOT_INDEXES="
tasks_company_created_active_idx
tasks_company_assignee_active_idx
tasks_company_status_active_idx
notifications_company_user_created_idx
idx_attendance_records_employee_date
idx_leave_requests_employee_date
idx_tasks_assignee_status_due
idx_notifications_unread
idx_audit_logs_company_created
"
for idx in $HOT_INDEXES; do
  HAS="$(PSQL "$TMP_URL" -tAc "SELECT count(*) FROM pg_indexes WHERE indexname='$idx';" 2>/dev/null)"
  [[ "$HAS" == "1" ]] || fail "thiếu index hot-path: $idx"
done
ok "index hot-path (G16-2 + canonical ATT/LEAVE/TASK/NOTI/AUDIT) hiện diện"

# ── 5) SMOKE: query đọc cơ bản chạy được (schema dùng được, không chỉ tồn tại) ──
log "5/5 smoke check (read query trên schema khôi phục)"
PSQL "$TMP_URL" -v ON_ERROR_STOP=1 -tAc \
  "SELECT count(*) FROM companies;
   SELECT count(*) FROM users;
   SELECT count(*) FROM tasks;" >/dev/null \
  || fail "smoke read query lỗi"
# Smoke qua đường tenant-GUC: set app.current_company_id rồi đọc — chứng minh GUC + đường đọc dùng được
# sau restore (hàm/policy tham chiếu current_setting không vỡ ở mức query). UUID giả → kỳ vọng chạy không lỗi.
# (Enforcement THẬT của policy đã được kiểm cấu trúc ở bước 4 qua pg_policies — superuser bypass RLS nên
#  bước này KHÔNG khẳng định lọc, chỉ khẳng định query-path chạy.)
PSQL "$TMP_URL" -v ON_ERROR_STOP=1 -tAc \
  "SET app.current_company_id = '00000000-0000-0000-0000-000000000000';
   SELECT count(*) FROM tasks;
   SELECT count(*) FROM employee_profiles;" >/dev/null \
  || fail "smoke tenant-GUC read lỗi (đường đọc/hàm policy có thể không khôi phục được)"
ok "smoke read (cơ bản + tenant-GUC) chạy được"

log "DRILL PASS ✅ — backup KHÔI PHỤC ĐƯỢC (restore + verify migration/schema/RLS/index + smoke đều xanh)"
