#!/usr/bin/env bash
# canary-watch.sh — smoke / canary post-deploy cho MediaOS API (GX-5).
#
# Tinh thần ecc:canary-watch (skill) áp cho lớp API: sau khi deploy/merge, GỌI endpoint health
# THẬT, retry trong cửa sổ warmup, PHÂN BIỆT liveness vs readiness, trả exit code rõ ràng cho
# CI/cron/uptime-monitor. Không phải test đơn vị — là kiểm chứng "app vừa deploy có sống + dùng được".
#
# Hai cổng health (đã có sẵn, health.controller.ts):
#   GET {prefix}/health     liveness  — KHÔNG chạm DB; 200 + {"status":"ok"} là sống.
#   GET {prefix}/health/db  readiness — ping DB, FAIL-SOFT: luôn 200, body {"status":"ok"|"down"}.
#     Vì readiness fail-soft (200 cả khi DB rớt), canary PHẢI đọc body để phân biệt — KHÔNG dựa
#     mã HTTP. Mặc định coi "down" là FAIL (REQUIRE_DB=1): app sống nhưng không dùng được vẫn là đỏ.
#
# Cấu hình qua biến môi trường (hoặc cờ):
#   CANARY_BASE_URL   gốc API kèm prefix (mặc định http://localhost:3100/api/v1)
#   CANARY_TIMEOUT    timeout mỗi request, giây (mặc định 5)
#   CANARY_RETRIES    số lần thử liveness trước khi bỏ cuộc (mặc định 12)
#   CANARY_INTERVAL   giây giữa các lần thử (mặc định 5) → cửa sổ warmup ≈ RETRIES×INTERVAL
#   CANARY_REQUIRE_DB =1 (mặc định) coi readiness "down" là FAIL; =0 chỉ CẢNH BÁO (liveness là đủ)
#
# Cờ:  --base URL  --no-db  --once (1 lượt, bỏ retry)  --timeout N  --help
#
# Exit:  0 HEALTHY · 1 liveness fail (app không sống) · 2 readiness/DB down (khi REQUIRE_DB=1)
#        3 lỗi cấu hình/thiếu công cụ.
#
# Ví dụ:
#   bash scripts/canary-watch.sh                                  # localhost, mặc định
#   CANARY_BASE_URL=https://api.funtimemediacorp.com/api/v1 bash scripts/canary-watch.sh
#   bash scripts/canary-watch.sh --once --no-db                  # smoke nhanh, chỉ liveness
#   CANARY_BASE_URL=... bash scripts/canary-watch.sh --once || echo "DEPLOY ĐỎ"   # dùng trong CI

set -Eeuo pipefail

BASE_URL="${CANARY_BASE_URL:-http://localhost:3100/api/v1}"
TIMEOUT="${CANARY_TIMEOUT:-5}"
RETRIES="${CANARY_RETRIES:-12}"
INTERVAL="${CANARY_INTERVAL:-5}"
REQUIRE_DB="${CANARY_REQUIRE_DB:-1}"

log()  { printf '[canary %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "FAIL: $*" >&2; }
ok()   { log "OK: $*"; }

# In khối comment đầu file (bỏ shebang, dừng ở dòng không phải comment) — không phụ thuộc số dòng.
usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next}{exit}' "$0"; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)    BASE_URL="${2:?--base cần URL}"; shift 2 ;;
    --timeout) TIMEOUT="${2:?--timeout cần số}"; shift 2 ;;
    --no-db)   REQUIRE_DB=0; shift ;;
    --once)    RETRIES=1; shift ;;   # 1 lượt, bỏ retry (RETRIES=1 mã hoá trọn ý --once)
    --help|-h) usage 0 ;;
    *) fail "tham số lạ: $1"; usage 3 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { fail "curl không có trên PATH"; exit 3; }
BASE_URL="${BASE_URL%/}"   # bỏ '/' cuối để nối path sạch

# Gọi 1 endpoint, in body + '\n' + mã HTTP. KHÔNG nuốt stderr của curl: lỗi mạng
# ("Connection refused"/"Could not resolve host"/timeout) cần lộ ra để triage deploy đỏ.
# `|| printf '\n000'` đã chặn exit non-zero (pipefail không lo); 000 = không gọi được.
http_get() {
  local url="$1"
  curl -sS -m "$TIMEOUT" -w $'\n%{http_code}' "$url" || printf '\n000'
}

# Trích trường "status" từ JSON (jq nếu có, fallback grep — không phụ thuộc jq).
# PHẢI luôn exit 0 (kể cả body rỗng / không khớp): chạy dưới `set -e + pipefail`, nếu để grep
# trả 1 thì assignment `status="$(json_status …)"` sẽ giết script TRƯỚC khi in chẩn đoán/retry.
json_status() {
  local body="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$body" | jq -r '.status // empty' 2>/dev/null || true
  else
    printf '%s' "$body" | grep -oE '"status"[[:space:]]*:[[:space:]]*"[^"]+"' 2>/dev/null \
      | head -1 | sed -E 's/.*:[[:space:]]*"([^"]+)"/\1/' || true
  fi
}

# ── 1) LIVENESS — retry trong cửa sổ warmup ──
LIVE_URL="$BASE_URL/health"
log "liveness: GET $LIVE_URL (retries=$RETRIES interval=${INTERVAL}s timeout=${TIMEOUT}s)"
live_ok=0
for ((i = 1; i <= RETRIES; i++)); do
  resp="$(http_get "$LIVE_URL")"
  body="${resp%$'\n'*}"
  code="${resp##*$'\n'}"
  status="$(json_status "$body")"
  if [[ "$code" == "200" && "$status" == "ok" ]]; then
    ok "liveness 200 status=ok (lần thử $i/$RETRIES)"
    live_ok=1
    break
  fi
  if [[ "$i" -lt "$RETRIES" ]]; then
    log "  thử $i/$RETRIES: code=$code status=${status:-<none>} — chờ ${INTERVAL}s"
    sleep "$INTERVAL"
  else
    log "  thử $i/$RETRIES: code=$code status=${status:-<none>}"
  fi
done

if [[ "$live_ok" -ne 1 ]]; then
  fail "liveness KHÔNG xanh sau $RETRIES lần — app không sống (deploy đỏ)"
  exit 1
fi

# ── 2) READINESS — đọc BODY (fail-soft trả 200 cả khi DB down) ──
DB_URL="$BASE_URL/health/db"
log "readiness: GET $DB_URL"
resp="$(http_get "$DB_URL")"
body="${resp%$'\n'*}"
code="${resp##*$'\n'}"
db_status="$(json_status "$body")"

if [[ "$code" != "200" ]]; then
  # readiness PHẢI 200 (fail-soft). Khác 200 = lỗi tầng app/proxy, không chỉ DB.
  fail "readiness trả HTTP $code (kỳ vọng 200 fail-soft) — tầng app/proxy hỏng"
  exit 2
fi

case "$db_status" in
  ok)
    ok "readiness status=ok — DB ping được"
    ;;
  down)
    if [[ "$REQUIRE_DB" == "1" ]]; then
      fail "readiness status=down — DB không ping được (REQUIRE_DB=1 → deploy đỏ)"
      exit 2
    fi
    log "WARN: readiness status=down nhưng REQUIRE_DB=0 → chỉ cảnh báo (liveness đủ)"
    ;;
  *)
    fail "readiness status không nhận diện được: '${db_status:-<none>}' — body bất thường"
    exit 2
    ;;
esac

log "CANARY PASS ✅ — liveness sống + readiness$([[ "$REQUIRE_DB" == "1" ]] && echo ' (DB ok)') → deploy sạch"
