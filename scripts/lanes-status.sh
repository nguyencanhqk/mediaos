#!/usr/bin/env bash
# Bảng trạng thái mọi lane worktree của MediaOS.
# Dùng: bash scripts/lanes-status.sh            (snapshot 1 lần)
#       bash scripts/lanes-status.sh -f         (file dirty của từng lane)
#       bash scripts/lanes-status.sh -w         (watch, refresh mỗi 5s)
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
SHOW_FILES=0; WATCH=0
for a in "$@"; do [ "$a" = "-f" ] && SHOW_FILES=1; [ "$a" = "-w" ] && WATCH=1; done

snapshot() {
  printf "%-26s %-20s %-6s %-15s %s\n" "LANE" "BRANCH" "DIRTY" "LAST-COMMIT" "MSG"
  printf '%.0s-' {1..118}; echo ""
  git -C "$ROOT" worktree list --porcelain | grep '^worktree ' | sed 's/^worktree //' | while IFS= read -r wt; do
    name=$(basename "$wt")
    [ "$name" = "$(basename "$ROOT")" ] && continue
    br=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
    dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    ctime=$(git -C "$wt" log -1 --format='%cd' --date=format:'%m-%d %H:%M' 2>/dev/null || echo '-')
    msg=$(git -C "$wt" log -1 --format='%s' 2>/dev/null | cut -c1-44 || echo '-')
    printf "%-26s %-20s %-6s %-15s %s\n" "$name" "$br" "$dirty" "$ctime" "$msg"
    if [ "$SHOW_FILES" = 1 ] && [ "$dirty" != 0 ]; then
      git -C "$wt" status --short 2>/dev/null | sed 's/^/    /'
    fi
  done
}

if [ "$WATCH" = 1 ]; then
  while true; do clear; date '+%H:%M:%S'; snapshot; sleep 5; done
else
  snapshot
fi
