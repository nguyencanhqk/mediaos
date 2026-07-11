#!/usr/bin/env bash
# harness/check.sh — KIỂM CHỨNG 1 lệnh: gói lint + typecheck + test (đã có sẵn, chỉ gói lại).
#
# Đây KHÔNG phải verify mới — nó wrap pnpm lint/typecheck/test (turbo) + smoke tuỳ chọn, chạy HẾT
# rồi báo cáo từng phần (không dừng ở lỗi đầu), trả exit 1 nếu có bất kỳ phần nào đỏ.
#
# THANG KIỂM CHỨNG (validation ladder) — 3 tầng, chọn theo độ rủi ro:
#   --quick   lint + typecheck                     (KHÔNG test, KHÔNG build, KHÔNG DB)  ◀ Stop-hook gate, phản hồi nhanh
#   (mặc định) lint + typecheck + test              (tầng thường cho 1 Work Order)
#   --all     lint + typecheck + test + build       (tiền-merge / vùng đỏ; xanh ở đây mới mở PR)
#
# LANE-DB GUARD (2026-07, S5-QA-GATE-LANEDB-1) — vì sao thêm:
#   Nhiều suite deny-path/IDOR/cross-tenant tự SKIP (không FAIL) khi thiếu LANE_DB (describe.skipIf
#   !hasDb) → `pnpm test` báo XANH dù các đường-từ-chối chưa hề chạy (xem memory
#   ci-skips-most-integration-specs). check.sh giờ:
#     1) luôn chạy step test với TURBO_FORCE=1 (chống turbo TRẢ LOG CŨ từ cache = XANH giả — xem
#        memory turbo-cache-false-green) + `tee` output ra file tạm để vẫn stream ra console.
#     2) sau đó gọi `node harness/lane-db-guard.mjs <log>` (logic thuần, test riêng ở
#        harness/lane-db-guard.test.mjs) đếm số test-file bị SKIP.
#     3) LANE_DB CHƯA set và N > INT_SKIP_THRESHOLD (mặc định 20, tunable qua env) → in banner LOUD
#        + đổi dòng kết-luận cuối từ "XANH ✅" sang trạng-thái-thứ-ba "XANH KHÔNG ĐỦ BẰNG CHỨNG"
#        (exit code MẶC ĐỊNH VẪN 0 — KHÔNG phá tier thường/warn-only).
#     4) CHỈ escalate thành ĐỎ (exit 1) khi tier `--all` HOẶC biến `REQUIRE_LANE_DB=1`: dùng cho
#        pre-merge/red-zone — nơi deny-path/IDOR/cross-tenant BẮT BUỘC đã chạy trước khi mở PR.
#   Contract mặc định của `bash harness/check.sh` trần (không cờ, không env) KHÔNG đổi: vẫn warn-only,
#   không tự làm đỏ tier thường chỉ vì thiếu Postgres cục bộ.
#
# Dùng:
#   bash harness/check.sh                       # tầng thường: lint + typecheck + test
#   bash harness/check.sh --quick                # tầng nhanh (Stop hook): lint + typecheck
#   bash harness/check.sh --all                  # tầng đầy đủ: + build; N skip > ngưỡng → ĐỎ (deny-path bắt buộc)
#   bash harness/check.sh --no-test              # alias cũ của --quick (bỏ test)
#   bash harness/check.sh --smoke                # + scripts/smoke-test-g3.sh (cần API đang chạy)
#   bash harness/check.sh --lane-db               # opt-in: tự tạo DB cô lập mediaos_check qua
#                                                 # scripts/lane-db-setup.sh + export LANE_DB rồi
#                                                 # chạy test NHƯ CI (cần Docker/Postgres; lỗi →
#                                                 # cảnh báo rõ, KHÔNG bắt buộc Docker, KHÔNG hard-fail)
#   bash harness/check.sh --lane-db=g13           # tên lane tuỳ chọn → DB mediaos_g13
#   LANE_DB=mediaos_g11 bash harness/check.sh     # dùng DB cô lập đã tự tạo từ trước (giữ nguyên)
#   REQUIRE_LANE_DB=1 bash harness/check.sh       # ép escalate ĐỎ nếu int-spec skip vượt ngưỡng
#   INT_SKIP_THRESHOLD=30 bash harness/check.sh   # đổi ngưỡng cảnh báo (mặc định 20)

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

RUN_TEST=1
RUN_SMOKE=0
RUN_BUILD=0
RUN_ALL=0
RUN_LANE_DB=0
LANE_DB_NAME="check"
for a in "$@"; do
  case "$a" in
    --quick)     RUN_TEST=0 ;;
    --no-test)   RUN_TEST=0 ;;
    --all)       RUN_TEST=1; RUN_BUILD=1; RUN_ALL=1 ;;
    --smoke)     RUN_SMOKE=1 ;;
    --lane-db)   RUN_LANE_DB=1 ;;
    --lane-db=*) RUN_LANE_DB=1; LANE_DB_NAME="${a#--lane-db=}" ;;
  esac
done

INT_SKIP_THRESHOLD="${INT_SKIP_THRESHOLD:-20}"
REQUIRE_LANE_DB="${REQUIRE_LANE_DB:-0}"

FAIL=0
declare -a SUMMARY
GUARD_LEVEL=""
GUARD_MESSAGE=""

step() { # step "<nhãn>" <lệnh...>
  local label="$1"; shift
  echo ""
  echo "──▶ $label"
  if "$@"; then
    SUMMARY+=("✅ $label")
  else
    SUMMARY+=("❌ $label")
    FAIL=1
  fi
}

# ── opt-in (b): tự provision DB cô lập cho lần chạy này, chạy như CI khi có Postgres ─────────
if [ "$RUN_LANE_DB" = 1 ] && [ "$RUN_TEST" = 1 ]; then
  echo ""
  echo "──▶ lane-db-setup (--lane-db=$LANE_DB_NAME)"
  if bash scripts/lane-db-setup.sh "$LANE_DB_NAME"; then
    export LANE_DB="mediaos_${LANE_DB_NAME}"
    echo "[check.sh] LANE_DB=$LANE_DB sẵn sàng — step test chạy NHƯ CI (deny-path/IDOR/cross-tenant KHÔNG bị skip)."
  else
    echo "[check.sh] ⚠️  lane-db-setup.sh thất bại (không có Docker/Postgres đang chạy?) — tiếp tục KHÔNG có LANE_DB."
    echo "[check.sh]     Docker KHÔNG bắt buộc để dùng check.sh; xem banner cảnh báo bên dưới nếu int-spec bị skip nhiều."
  fi
fi

step "lint"      pnpm lint
step "typecheck" pnpm typecheck

# ── step test: TURBO_FORCE=1 (chống turbo-cache false-green) + tee ra log tạm cho guard đọc ──
if [ "$RUN_TEST" = 1 ]; then
  TEST_LOG="$(mktemp 2>/dev/null || echo "/tmp/check-test-$$.log")"

  run_test_with_guard() {
    TURBO_FORCE=1 pnpm test 2>&1 | tee "$TEST_LOG"
    local vitest_status=${PIPESTATUS[0]}

    local strict=0
    { [ "$RUN_ALL" = 1 ] || [ "$REQUIRE_LANE_DB" = 1 ]; } && strict=1
    local lane_db_set=0
    [ -n "${LANE_DB:-}" ] && lane_db_set=1

    local guard_out
    guard_out="$(node harness/lane-db-guard.mjs "$TEST_LOG" --lane-db-set="$lane_db_set" --threshold="$INT_SKIP_THRESHOLD" --strict="$strict")"
    GUARD_LEVEL="$(printf '%s\n' "$guard_out" | grep '^LEVEL:' | cut -d: -f2-)"
    GUARD_MESSAGE="$(printf '%s\n' "$guard_out" | grep '^MESSAGE:' | cut -d: -f2-)"

    return "$vitest_status"
  }

  step "test ${LANE_DB:+(LANE_DB=$LANE_DB)}" run_test_with_guard
  rm -f "$TEST_LOG" 2>/dev/null || true
fi

[ "$RUN_BUILD" = 1 ]  && step "build" pnpm build
[ "$RUN_SMOKE" = 1 ]  && step "smoke" bash scripts/smoke-test-g3.sh

# ── lane-db guard: banner LOUD + escalate riêng, tách khỏi pass/fail của bản thân step "test" ──
if [ "$GUARD_LEVEL" = "warn" ] || [ "$GUARD_LEVEL" = "red" ]; then
  echo ""
  echo "⚠️⚠️⚠️  LANE-DB GUARD  ⚠️⚠️⚠️"
  echo "⚠️  $GUARD_MESSAGE"
  echo "⚠️  Chạy \`bash harness/check.sh --lane-db\` (cần Postgres) để có bằng chứng thật, hoặc export LANE_DB=mediaos_<lane>."
  echo "⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️"
  if [ "$GUARD_LEVEL" = "red" ]; then
    SUMMARY+=("❌ lane-db-guard: $GUARD_MESSAGE")
    FAIL=1
  else
    SUMMARY+=("⚠️  lane-db-guard: $GUARD_MESSAGE")
  fi
fi

echo ""
echo "═══════════ KẾT QUẢ CHECK ═══════════"
for s in "${SUMMARY[@]}"; do echo "  $s"; done
if [ "$FAIL" = 1 ]; then
  echo "═════════ ĐỎ ❌ — truy ROOT-CAUSE (AUTOMATION-PLAYBOOK §5), KHÔNG vá triệu chứng ═════════"
elif [ "$GUARD_LEVEL" = "warn" ]; then
  echo "═══════ XANH KHÔNG ĐỦ BẰNG CHỨNG ⚠️  (int-spec bị skip — xem banner ở trên) ═══════"
else
  echo "═════════════ XANH ✅ ════════════════"
fi
exit "$FAIL"
