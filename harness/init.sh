#!/usr/bin/env bash
# harness/init.sh — MỞ PHIÊN: trả lời "đang ở đâu · làm gì · sửa ở đâu" trong 1 màn.
# Đọc lại trí nhớ (handoff) + tái sinh STATUS + in Work Order đang làm. KHÔNG đụng file nguồn.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

echo "════════════════ MỞ PHIÊN — MediaOS ════════════════"
echo ""
echo "▸ Đồng bộ (best-effort, không treo nếu cần auth)…"
GIT_TERMINAL_PROMPT=0 git fetch --quiet 2>/dev/null || echo "  (bỏ qua fetch — offline/không remote/cần auth)"

echo ""
echo "▸ Tái sinh trạng thái…"
node harness/gen-status.mjs

echo ""
echo "▸ Repo:"
git status -sb 2>/dev/null | head -12

echo ""
echo "════════════════ TIÊU ĐIỂM (làm gì · sửa ở đâu) ════════════════"
node harness/gen-status.mjs --focus

echo ""
echo "════════════════ PHIÊN KHÁC ĐANG GIỮ (chống làm trùng) ════════════════"
node harness/claim.mjs list

echo "════════════════ BÀN GIAO TỪ PHIÊN TRƯỚC (memory) ════════════════"
if [ -f harness/handoff.md ]; then
  sed -n '1,40p' harness/handoff.md
else
  echo "(chưa có harness/handoff.md)"
fi

echo ""
echo "→ Làm 1 Work Order. TRONG vòng lặp dùng tầng NHANH: 'bash harness/check.sh --quick' (lint+typecheck, KHÔNG DB/test)."
echo "→ ĐÓNG việc: 'bash harness/finish.sh' (chạy FULL + test). Pre-merge/vùng đỏ: 'bash harness/check.sh --all'."
echo "→ Chi tiết đầy đủ: docs/STATUS.md · cách làm: harness/README.md"
