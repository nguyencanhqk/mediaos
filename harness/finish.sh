#!/usr/bin/env bash
# harness/finish.sh — ĐÓNG PHIÊN: verify → tái sinh STATUS → nhắc ghi nhớ/bàn giao → (tuỳ chọn) commit.
#
# Dùng:
#   bash harness/finish.sh                       # check + regen status + nhắc việc cuối
#   bash harness/finish.sh --no-check            # bỏ check (khi đã chạy riêng)
#   bash harness/finish.sh --commit "feat(x): …" # commit-if-safe: chỉ commit khi check XANH & KHÔNG vùng đỏ
#
# Triết lý: vùng 🔴 (payroll/RLS/secret/finance) KHÔNG bao giờ auto-commit — người chốt (CLAUDE.md §6).

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

RUN_CHECK=1
COMMIT_MSG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-check) RUN_CHECK=0; shift ;;
    --commit)   COMMIT_MSG="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

echo "════════════════ ĐÓNG PHIÊN — MediaOS ════════════════"

CHECK_OK=1
if [ "$RUN_CHECK" = 1 ]; then
  bash harness/check.sh || CHECK_OK=0
else
  echo "▸ (bỏ qua check theo --no-check)"
fi

echo ""
echo "▸ Tái sinh trạng thái…"
node harness/gen-status.mjs

# Work Order đang làm: id + zone (status HIỆU DỤNG = overlay ledger đè literal) — để quyết auto-commit/finish.
INPROG=$(node -e "Promise.all([import('./harness/backlog.mjs'),import('./harness/lib/wo-state.mjs')]).then(([m,s])=>{const b=s.applyStatus(m.backlog).find(x=>x.status==='in_progress');process.stdout.write(b?b.id+' '+b.zone:'')}).catch(()=>{})" 2>/dev/null)
INPROG_ID="${INPROG%% *}"
INPROG_ZONE="${INPROG##* }"

if [ -n "$COMMIT_MSG" ]; then
  echo ""
  if [ "$CHECK_OK" != 1 ]; then
    echo "⛔ KHÔNG commit: check ĐỎ. Truy root-cause trước (AUTOMATION-PLAYBOOK §5)."
  elif [ "$INPROG_ZONE" = "red" ]; then
    echo "⛔ KHÔNG auto-commit: Work Order $INPROG_ID là vùng ĐỎ → người chốt + người commit tay (CLAUDE.md §6)."
  else
    if git add -A && git commit -m "$COMMIT_MSG"; then
      echo "✅ Đã commit: $COMMIT_MSG"
      # AUTO-FINISH: commit xanh + non-red → đóng dấu ledger 'committed' ⇒ board tự nhảy WO sang 'done'.
      if [ -n "$INPROG_ID" ]; then
        LEDGER_BY=finish.sh node harness/ledger.mjs event "$INPROG_ID" committed "$COMMIT_MSG" >/dev/null 2>&1 \
          && echo "🗂️  Ledger: $INPROG_ID → done (committed)."
      fi
    fi
  fi
fi

echo ""
echo "════════════════ VIỆC CUỐI PHIÊN (kỷ luật) ════════════════"
echo "  • Status TỰ ĐỘNG từ ledger: chạm file → 'started'; commit xanh non-red → 'done'."
echo "  • Vùng ĐỎ / đóng tay: 'node harness/ledger.mjs done $INPROG_ID' (đừng sửa status literal — overlay sẽ đè)."
echo "  • Thêm/đổi cơ cấu WO (title/zone/paths/deps) → harness/backlog.mjs; mục mới mặc định 'todo'."
echo "  • Ghi harness/handoff.md (đã làm/đang dở/bẫy/việc kế) → chạy lại: node harness/gen-status.mjs."
[ "$CHECK_OK" = 1 ] && echo "  Check: XANH ✅" || echo "  Check: ĐỎ ❌ — chưa được đóng việc."
