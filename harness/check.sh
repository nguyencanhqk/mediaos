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
# Dùng:
#   bash harness/check.sh                 # tầng thường: lint + typecheck + test
#   bash harness/check.sh --quick         # tầng nhanh (Stop hook): lint + typecheck
#   bash harness/check.sh --all           # tầng đầy đủ: + build (chạy trước khi mở PR)
#   bash harness/check.sh --no-test       # alias cũ của --quick (bỏ test)
#   bash harness/check.sh --smoke         # + scripts/smoke-test-g3.sh (cần API đang chạy)
#   LANE_DB=mediaos_g11 bash harness/check.sh   # test trên DB cô lập (xem CLAUDE.md §9)

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

RUN_TEST=1
RUN_SMOKE=0
RUN_BUILD=0
for a in "$@"; do
  case "$a" in
    --quick)   RUN_TEST=0 ;;
    --no-test) RUN_TEST=0 ;;
    --all)     RUN_TEST=1; RUN_BUILD=1 ;;
    --smoke)   RUN_SMOKE=1 ;;
  esac
done

FAIL=0
declare -a SUMMARY

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

step "lint"      pnpm lint
step "typecheck" pnpm typecheck
[ "$RUN_TEST" = 1 ]  && step "test ${LANE_DB:+(LANE_DB=$LANE_DB)}" pnpm test
[ "$RUN_BUILD" = 1 ] && step "build" pnpm build
[ "$RUN_SMOKE" = 1 ] && step "smoke" bash scripts/smoke-test-g3.sh

echo ""
echo "═══════════ KẾT QUẢ CHECK ═══════════"
for s in "${SUMMARY[@]}"; do echo "  $s"; done
if [ "$FAIL" = 0 ]; then
  echo "═════════════ XANH ✅ ════════════════"
else
  echo "═════════ ĐỎ ❌ — truy ROOT-CAUSE (AUTOMATION-PLAYBOOK §5), KHÔNG vá triệu chứng ═════════"
fi
exit "$FAIL"
