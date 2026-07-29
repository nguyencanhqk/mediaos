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
# CHUNK RUNNER (2026-07-27, S6-QA-CHUNK-1 — đóng KI-014) — vì sao thêm:
#   Trên Windows, `pnpm test` ĐỎ 100% (5/5 lần đo) vì crash hạ tầng của tinypool@1.1.1
#   (ERR_IPC_CHANNEL_CLOSED / ACCESS_VIOLATION) với **0 ca test đỏ** ⇒ cổng verify local vô dụng,
#   dạy người đọc bỏ qua đỏ THẬT. Gốc là bug ngược dòng, KHÔNG vá được trong phạm vi WO (số đo:
#   docs/QA/evidence/S6-QA-CHUNK-1-KI-014-ROOT-CAUSE.md). Nên step test giờ:
#     • Windows  → `node harness/chunk-test.mjs` (chia chunk + chạy lại chunk chết vì hạ tầng +
#                   ĐỐI CHIẾU số file với `vitest list` ⇒ không thể giảm phạm vi lén).
#     • Khác/CI  → GIỮ NGUYÊN `TURBO_FORCE=1 pnpm test` một lần.
#   Ép tay bằng `CHUNK_RUNNER=1` / `CHUNK_RUNNER=0`. Runner vẫn in dòng summary của vitest nên
#   lane-db-guard bên dưới hoạt động y như cũ (verify: 184 skip khi thiếu LANE_DB → đỏ ở tier --all).
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

# ── KI-014 (S6-QA-CHUNK-1): chọn ĐƯỜNG CHẠY TEST theo nền tảng ───────────────────────────────
# Windows (máy dev này): `pnpm test` ĐỎ 100% (5/5 lần đo) vì crash hạ tầng tinypool
# ERR_IPC_CHANNEL_CLOSED — **0 test đỏ**. Gốc nằm ngoài repo và không vá được trong phạm vi WO
# (số đo đầy đủ: docs/QA/evidence/S6-QA-CHUNK-1-KI-014-ROOT-CAUSE.md) ⇒ chạy chia chunk.
# Linux/macOS + CI ubuntu: GIỮ NGUYÊN đường `pnpm test` một-lần (CI chưa từng dính KI-014).
# Ép tay: CHUNK_RUNNER=1 (bật) · CHUNK_RUNNER=0 (tắt, quay lại pnpm test).
case "${CHUNK_RUNNER:-auto}" in
  1) USE_CHUNK_RUNNER=1 ;;
  0) USE_CHUNK_RUNNER=0 ;;
  *)
    case "$(uname -s 2>/dev/null || echo unknown)" in
      MINGW*|MSYS*|CYGWIN*|Windows_NT) USE_CHUNK_RUNNER=1 ;;
      *)                               USE_CHUNK_RUNNER=0 ;;
    esac
    ;;
esac

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
  # S6-SEC-ROTATE-1 (KI-043): vitest.config → test/db-target.ts tổng hợp URL lane từ 3 biến này. Chúng
  # KHÔNG còn literal mặc định, nên check.sh phải nạp từ .env (không tracked) rồi export xuống vitest.
  # shellcheck source=../scripts/lib/db-secrets.sh
  . scripts/lib/db-secrets.sh
  db_secrets_load
  # KHÔNG hard-fail: header file này hứa "lỗi → cảnh báo rõ, KHÔNG bắt buộc Docker, KHÔNG hard-fail",
  # và worktree lane thường KHÔNG có .env (memory worktree-missing-kek-false-red). Thiếu mật khẩu ⇒ bỏ
  # LANE_DB, chạy tiếp; int-spec sẽ SKIP và `lane-db-guard` vẫn escalate ĐỎ ở tier --all/REQUIRE_LANE_DB
  # — tức vẫn không thể lỡ merge với bằng chứng deny-path rỗng.
  if db_secrets_require SUPERUSER_DB_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD; then
    export SUPERUSER_DB_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD
    LANE_SECRETS_OK=1
  else
    echo "[check.sh] ⚠️  thiếu mật khẩu DB → BỎ QUA lane-db; int-spec sẽ skip (banner bên dưới sẽ nói rõ)."
    LANE_SECRETS_OK=0
  fi
  # Đích DB của lần chạy này là LANE_DB — mà URL tường minh THẮNG LANE_DB (precedence trong
  # test/db-target.ts). Nếu shell/parent còn sót DATABASE_*_URL trỏ PROD thì cả suite chạy vào PROD.
  # Đây chính là điều thông báo lỗi của hàng rào KI-028 dặn làm; làm luôn cho người dùng.
  unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL
  if [ "$LANE_SECRETS_OK" = 1 ] && bash scripts/lane-db-setup.sh "$LANE_DB_NAME"; then
    export LANE_DB="mediaos_${LANE_DB_NAME}"
    echo "[check.sh] LANE_DB=$LANE_DB sẵn sàng — step test chạy NHƯ CI (deny-path/IDOR/cross-tenant KHÔNG bị skip)."
  else
    echo "[check.sh] ⚠️  lane-db-setup.sh thất bại (không có Docker/Postgres đang chạy?) — tiếp tục KHÔNG có LANE_DB."
    echo "[check.sh]     Docker KHÔNG bắt buộc để dùng check.sh; xem banner cảnh báo bên dưới nếu int-spec bị skip nhiều."
  fi
fi

# S6-SEC-ROTATE-1 (KI-043): chốt hồi quy literal secret + bind cổng. Đặt TRƯỚC lint/test vì nó rẻ (chỉ
# đọc file tracked) và vì nếu vi phạm thì mọi kết quả sau đó cũng không cứu được — literal quay lại repo
# PUBLIC là lỗ hổng đang mở, không phải một cảnh báo phong cách.
step "secret-literals" node scripts/check-no-secret-literals.mjs

step "lint"      pnpm lint
step "typecheck" pnpm typecheck

# ── step test: TURBO_FORCE=1 (chống turbo-cache false-green) + tee ra log tạm cho guard đọc ──
if [ "$RUN_TEST" = 1 ]; then
  TEST_LOG="$(mktemp 2>/dev/null || echo "/tmp/check-test-$$.log")"

  run_test_with_guard() {
    if [ "$USE_CHUNK_RUNNER" = 1 ]; then
      # KI-014: trên Windows `pnpm test` chết vì crash hạ tầng của tinypool (0 test đỏ) — chạy chia
      # chunk thay thế. Runner tự lo `^build` + đối chiếu số file với `vitest list` + gộp 1 mã thoát.
      node harness/chunk-test.mjs 2>&1 | tee "$TEST_LOG"
    else
      TURBO_FORCE=1 pnpm test 2>&1 | tee "$TEST_LOG"
    fi
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

  if [ "$USE_CHUNK_RUNNER" = 1 ]; then
    echo ""
    echo "[check.sh] step test dùng CHUNK RUNNER (harness/chunk-test.mjs) — KI-014, nền tảng $(uname -s)."
    echo "[check.sh]   tắt bằng CHUNK_RUNNER=0 nếu muốn quay lại \`pnpm test\` một lần."
  fi

  TEST_LABEL_SUFFIX=""
  [ "$USE_CHUNK_RUNNER" = 1 ] && TEST_LABEL_SUFFIX=" [chunked]"
  step "test ${LANE_DB:+(LANE_DB=$LANE_DB)}$TEST_LABEL_SUFFIX" run_test_with_guard
  rm -f "$TEST_LOG" 2>/dev/null || true
fi

[ "$RUN_BUILD" = 1 ]  && step "build" pnpm build
[ "$RUN_SMOKE" = 1 ]  && step "smoke" bash scripts/smoke-test-g3.sh

# ── S6-SEC-DBFENCE-1 (KI-028): DB PROD có tenant test ⇒ ĐỎ ──────────────────────────────────
# KI-028 từng được "đóng" bằng cách dọn rác mà KHÔNG có chốt nào canh rác mọc lại — 2 ngày sau
# 16 tenant test thành 74. Chốt ở tier --all (tier trước khi mở PR vùng đỏ). Script tự BỎ QUA
# (exit 0 + cảnh báo) khi không với tới DB PROD ⇒ máy không có PROD/CI không bị đỏ-giả.
[ "$RUN_ALL" = 1 ] && step "prod-tenant-check" node scripts/check-prod-test-tenants.mjs

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
