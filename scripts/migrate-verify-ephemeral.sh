#!/usr/bin/env bash
# migrate-verify-ephemeral.sh — S5-DEVOPS-1: chứng minh MIGRATE-FROM-EMPTY (0000→head) áp SẠCH trên một
# DB THROWAWAY, tách biệt hoàn toàn khỏi DB dev/CI dùng chung (mediaos, mediaos_dev).
#
# Tinh thần mượn từ scripts/backup-restore-drill.sh (mint DB tạm → verify → tự dọn qua trap EXIT) nhưng
# KHÔNG dump/restore — ở đây CREATE DATABASE hoàn toàn RỖNG, chạy `db:migrate` (0000→head) rồi `db:check`
# (apps/api/src/db/check.ts — head idx đọc ĐỘNG từ journal, số file .sql == entries.length ĐỘNG, hiện 173)
# để chứng minh chuỗi migration áp sạch từ đầu, không GAP/trùng tag/lệch file.
#
# AN TOÀN (GUARD cứng, defense-in-depth — xem --self-test):
#   - CHỈ connection tới DB maintenance 'postgres' mới được CREATE DATABASE / DROP DATABASE. DDL nghiệp vụ
#     (migration) chạy trên chính DB ephemeral vừa tạo qua DATABASE_DIRECT_URL riêng — KHÔNG đi qua admin
#     conn.
#   - Tên DB bị DROP PHẢI khớp `^mediaos_migverify_[A-Za-z0-9_]+$` VÀ KHÔNG được là 'mediaos' hay
#     'mediaos_dev' (blocklist tường minh — phòng khi biến EPHEMERAL_DB bị ghi đè do bug). Vi phạm bất kỳ
#     điều kiện nào → REFUSE (return/exit ≠0), KHÔNG bao giờ chạm DROP DATABASE vào DB thật.
#   - Script KHÔNG BAO GIỜ migrate/ghi dữ liệu vào dbname trong DATABASE_DIRECT_URL gốc — URL đó CHỈ được
#     dùng để suy ra host/port/credential rồi mở admin conn 'postgres' và mint 1 DB ephemeral MỚI.
#   - Kết quả: 'mediaos' và 'mediaos_dev' byte-identical trước/sau khi chạy script này.
#
# Cấu hình qua biến môi trường:
#   DATABASE_DIRECT_URL  postgres://user:pass@host:port/dbname (DIRECT, cùng cluster cần verify)
#                         [BẮT BUỘC cho chạy thật — KHÔNG cần cho --self-test].
#   KEEP_EPHEMERAL        =1 để GIỮ DB ephemeral sau khi chạy (debug lỗi migrate). Mặc định DROP.
#   MIGVERIFY_PSQL        lệnh psql thay thế khi host không có psql trên PATH (Windows dev:
#                         "docker exec -i mediaos-postgres psql" — wrapper `m migrate-verify` tự set).
#                         CHỈ đổi cách GỌI psql, không đổi guard/URL. Mặc định: psql.
#
# Dùng:
#   DATABASE_DIRECT_URL=postgres://mediaos:pw@localhost:5432/mediaos bash scripts/migrate-verify-ephemeral.sh
#   bash scripts/migrate-verify-ephemeral.sh --self-test   # CHỈ test GUARD refuse-drop, KHÔNG cần Postgres
#
# Exit 0 = PASS (migrate-from-empty áp sạch + db:check xanh + DB ephemeral đã DROP). Khác 0 = FAIL.

set -Eeuo pipefail

log()  { printf '[migverify %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "FAIL: $*" >&2; exit 1; }
ok()   { log "OK: $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── GUARD: tên DB được phép DROP — hàm THUẦN (không cần Postgres), tự kiểm qua --self-test ──
is_protected_db_name() {
  case "$1" in
    mediaos|mediaos_dev) return 0 ;;
    *) return 1 ;;
  esac
}

is_ephemeral_migverify_name() {
  [[ "$1" =~ ^mediaos_migverify_[A-Za-z0-9_]+$ ]]
}

# guard_drop_allowed <name>: return 0 (cho phép) CHỈ KHI name khớp prefix ephemeral hợp lệ VÀ không nằm
# trong blocklist tường minh. Bất kỳ vi phạm nào → return 1 (refuse) — người gọi PHẢI fail cứng, KHÔNG
# được âm thầm bỏ qua.
guard_drop_allowed() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    log "GUARD: REFUSE drop — tên DB rỗng"
    return 1
  fi
  if is_protected_db_name "$name"; then
    log "GUARD: REFUSE drop — '$name' nằm trong blocklist {mediaos, mediaos_dev}"
    return 1
  fi
  if ! is_ephemeral_migverify_name "$name"; then
    log "GUARD: REFUSE drop — '$name' không khớp prefix ephemeral bắt buộc ^mediaos_migverify_"
    return 1
  fi
  return 0
}

# ── --self-test: chứng minh GUARD refuse-drop đúng — KHÔNG chạm Postgres/pnpm ──
SELF_TEST_FAILURES=0

assert_guard_refused() {
  if guard_drop_allowed "$1"; then
    log "SELF-TEST FAIL: guard CHO PHÉP drop '$1' — lẽ ra phải REFUSE"
    SELF_TEST_FAILURES=$((SELF_TEST_FAILURES + 1))
  else
    ok "guard REFUSE đúng: '$1'"
  fi
}

assert_guard_allowed() {
  if guard_drop_allowed "$1"; then
    ok "guard CHO PHÉP đúng: '$1'"
  else
    log "SELF-TEST FAIL: guard REFUSE '$1' — lẽ ra phải CHO PHÉP (tên ephemeral hợp lệ)"
    SELF_TEST_FAILURES=$((SELF_TEST_FAILURES + 1))
  fi
}

self_test() {
  log "SELF-TEST: guard refuse-drop (pure logic, không chạm Postgres)"
  assert_guard_refused "mediaos"
  assert_guard_refused "mediaos_dev"
  assert_guard_refused "postgres"
  assert_guard_refused ""
  assert_guard_refused "mediaos_migverify"                                # thiếu hậu tố sau prefix
  assert_guard_refused "mediaos_migverify_; DROP DATABASE mediaos; --"    # tên dạng injection
  assert_guard_allowed "mediaos_migverify_20260711120000_12345"
  assert_guard_allowed "mediaos_migverify_x"

  [[ "$SELF_TEST_FAILURES" -eq 0 ]] \
    || fail "SELF-TEST: $SELF_TEST_FAILURES assertion(s) FAIL — GUARD KHÔNG an toàn, KHÔNG dùng script này"
  ok "SELF-TEST PASS — guard chặn {mediaos, mediaos_dev} + mọi tên lạ; chỉ cho phép ^mediaos_migverify_"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit 0
fi
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

# ── Chạy thật: cần Postgres client + pnpm workspace ──
: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required (hoặc chạy --self-test)}"
# PSQL_CMD: mảng lệnh psql — mặc định `psql`; host không có psql (Windows dev) thì override qua
# MIGVERIFY_PSQL (vd "docker exec -i mediaos-postgres psql"). Word-split CHỦ ĐÍCH (không path có space).
read -r -a PSQL_CMD <<< "${MIGVERIFY_PSQL:-psql}"
command -v "${PSQL_CMD[0]}" >/dev/null 2>&1 \
  || fail "'${PSQL_CMD[0]}' không tìm thấy (cài postgresql-client hoặc set MIGVERIFY_PSQL)"
command -v pnpm >/dev/null 2>&1 || fail "pnpm không tìm thấy"

# ── Phân giải URL nguồn → BASE_URL + admin conn 'postgres' (mượn pattern backup-restore-drill.sh) ──
SRC_URL="$DATABASE_DIRECT_URL"
BASE_URL="${SRC_URL%/*}"                       # postgres://user:pass@host:port
SRC_DB_AND_QS="${SRC_URL##*/}"                 # dbname?query
QS=""
[[ "$SRC_DB_AND_QS" == *\?* ]] && QS="?${SRC_DB_AND_QS#*\?}"
ADMIN_URL="${BASE_URL}/postgres${QS}"          # admin conn — CHỈ conn này được CREATE/DROP DATABASE

# GUARD: admin conn phải trỏ đúng DB maintenance 'postgres' (không phải mediaos/mediaos_dev/khác).
ADMIN_DB_PART="${ADMIN_URL##*/}"
ADMIN_DB_PART="${ADMIN_DB_PART%%\?*}"
[[ "$ADMIN_DB_PART" == "postgres" ]] \
  || fail "GUARD: admin conn phải trỏ DB 'postgres' (maintenance), gặp '$ADMIN_DB_PART' — từ chối CREATE/DROP"

STAMP="$(date -u +%Y%m%d%H%M%S)"
EPHEMERAL_DB="mediaos_migverify_${STAMP}_$$"
EPHEMERAL_URL="${BASE_URL}/${EPHEMERAL_DB}${QS}"

# Sanity: tên vừa mint PHẢI được chính guard chấp nhận (nếu không, bug ở logic mint — dừng TRƯỚC CREATE).
is_ephemeral_migverify_name "$EPHEMERAL_DB" \
  || fail "BUG NỘI BỘ: tên ephemeral vừa mint '$EPHEMERAL_DB' không khớp guard — dừng trước khi CREATE"

cleanup() {
  local code=$?
  if [[ -n "${EPHEMERAL_DB:-}" ]]; then
    if [[ "${KEEP_EPHEMERAL:-0}" == "1" ]]; then
      # KHÔNG in ADMIN_URL (chứa credential) vào log — chỉ in tên DB + gợi ý lệnh.
      log "KEEP_EPHEMERAL=1 → GIỮ $EPHEMERAL_DB (nhớ DROP tay qua admin conn 'postgres': DROP DATABASE \"$EPHEMERAL_DB\")"
    elif guard_drop_allowed "$EPHEMERAL_DB"; then
      log "cleanup: DROP DATABASE $EPHEMERAL_DB (qua admin conn 'postgres')"
      "${PSQL_CMD[@]}" "$ADMIN_URL" -v ON_ERROR_STOP=0 -q \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$EPHEMERAL_DB' AND pid<>pg_backend_pid();" \
        -c "DROP DATABASE IF EXISTS \"$EPHEMERAL_DB\";" >/dev/null 2>&1 \
        || log "WARN: drop $EPHEMERAL_DB lỗi (dọn tay qua admin conn 'postgres': DROP DATABASE \"$EPHEMERAL_DB\")"
    else
      log "GUARD CHẶN drop '$EPHEMERAL_DB' — TÊN BẤT THƯỜNG (bug nghiêm trọng); KHÔNG đụng DB này — dọn tay + báo lỗi ngay"
      code=1
    fi
  fi
  exit "$code"
}
trap cleanup EXIT

# ── 1) CREATE DATABASE ephemeral (throwaway, hoàn toàn rỗng) — qua admin conn 'postgres' ──
log "1/3 CREATE DATABASE $EPHEMERAL_DB (throwaway, qua admin conn 'postgres')"
"${PSQL_CMD[@]}" "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$EPHEMERAL_DB\";" \
  || fail "không tạo được DB ephemeral $EPHEMERAL_DB"
ok "DB ephemeral sẵn sàng (rỗng)"

# ── 2) db:migrate 0000→head trên ephemeral — DATABASE_DIRECT_URL set TƯỜNG MINH cho lệnh này ──
log "2/3 db:migrate (0000→head) trên $EPHEMERAL_DB"
( cd "$REPO_ROOT" && DATABASE_DIRECT_URL="$EPHEMERAL_URL" pnpm --filter @mediaos/api db:migrate ) \
  || fail "db:migrate lỗi trên DB ephemeral — migrate-from-empty (0000→head) KHÔNG áp sạch"
ok "migrate-from-empty áp sạch trên $EPHEMERAL_DB"

# ── 3) db:check trên ephemeral — bất biến journal (forward-only, no-gap, no-dup) + số .sql == entries ──
log "3/3 db:check (journal bất biến, số .sql == entries.length ĐỘNG) trên $EPHEMERAL_DB"
( cd "$REPO_ROOT" && DATABASE_DIRECT_URL="$EPHEMERAL_URL" pnpm --filter @mediaos/api db:check ) \
  || fail "db:check lỗi trên DB ephemeral — journal/migrations lệch nhau hoặc bất biến forward-only vỡ"
ok "db:check PASS trên $EPHEMERAL_DB"

log "MIGRATE-VERIFY PASS ✅ — $EPHEMERAL_DB migrate-from-empty sạch + db:check xanh; sẽ DROP ở trap EXIT (mediaos/mediaos_dev không hề bị chạm tới)"
