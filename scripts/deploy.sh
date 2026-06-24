#!/usr/bin/env bash
# scripts/deploy.sh — Deploy MediaOS lên SERVER LINUX.
#
# Chạy TRÊN server (repo đã clone), hoặc qua SSH từ máy bạn:
#   ssh user@host 'cd /opt/mediaos && BRANCH=master bash scripts/deploy.sh'
#
# Quy trình:  git pull → pnpm install → build → db:migrate → restart API service → health check.
# (Tương ứng bộ Windows scripts/windows/* nhưng cho Linux + service systemd/pm2 thay vì Windows Service.)
#
# FE: các SPA build ra apps/{auth,web,studio,people,console,projects}/dist —
#     phục vụ qua nginx / static host (xem ghi chú cuối file). API nghe :3100 (ENV API_PORT).
#
# ── CẤU HÌNH (sửa trực tiếp ở đây HOẶC override qua biến môi trường khi gọi) ─────────────
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # repo root (mặc định = thư mục cha của script)
BRANCH="${BRANCH:-master}"
GIT_PULL="${GIT_PULL:-1}"          # 1 = git fetch + reset --hard origin/$BRANCH (BỎ thay đổi local)
INSTALL="${INSTALL:-1}"            # 1 = pnpm install --frozen-lockfile
BUILD="${BUILD:-1}"               # 1 = pnpm build (contracts + api + FE)
RUN_MIGRATE="${RUN_MIGRATE:-1}"    # 1 = pnpm db:migrate (cần DATABASE_DIRECT_URL trong .env)
SERVICE_MGR="${SERVICE_MGR:-systemd}"      # systemd | pm2 | none
API_SERVICE="${API_SERVICE:-mediaos-api}"  # tên systemd unit HOẶC tên app pm2
HEALTH_URL="${HEALTH_URL:-http://localhost:3100/api/v1/health}"

set -euo pipefail

c_b=$'\033[36m'; c_g=$'\033[32m'; c_y=$'\033[33m'; c_r=$'\033[31m'; c_0=$'\033[0m'
log()  { printf '%s\n' "${c_b}▶ $*${c_0}"; }
ok()   { printf '%s\n' "${c_g}✓ $*${c_0}"; }
warn() { printf '%s\n' "${c_y}! $*${c_0}"; }
err()  { printf '%s\n' "${c_r}✗ $*${c_0}" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || { err "Thiếu lệnh bắt buộc: $1"; exit 1; }; }

# ── Preflight ────────────────────────────────────────────────────────────────────────
log "MediaOS deploy → $APP_DIR (branch $BRANCH)"
need node; need pnpm; need git
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 20 ] || { err "Cần Node >= 20 (đang: $(node -v))"; exit 1; }
cd "$APP_DIR"
[ -f .env ] || { err ".env không tồn tại ở $APP_DIR — tạo từ .env.example + cấu hình PROD (secrets, DATABASE_*, AUTH_COOKIE_*) trước."; exit 1; }

# ── 1. Lấy code mới ──────────────────────────────────────────────────────────────────
if [ "$GIT_PULL" = 1 ]; then
  log "git fetch + reset --hard origin/$BRANCH (bỏ thay đổi local trên server)"
  git fetch --prune origin
  git reset --hard "origin/$BRANCH"
  ok "Đã đồng bộ $(git rev-parse --short HEAD)"
else
  warn "GIT_PULL=0 — bỏ qua pull, deploy code hiện có."
fi

# ── 2. Cài dependencies (reproducible) ───────────────────────────────────────────────
if [ "$INSTALL" = 1 ]; then
  log "pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile
fi

# ── 3. Build (contracts dual-build → api nest → FE vite) ─────────────────────────────
if [ "$BUILD" = 1 ]; then
  log "pnpm build"
  pnpm build
  ok "Build xong"
fi

# ── 4. Migration DB (idempotent: chỉ áp migration mới) ───────────────────────────────
if [ "$RUN_MIGRATE" = 1 ]; then
  log "pnpm db:migrate"
  pnpm db:migrate
  ok "DB đã migrate"
fi

# ── 5. Restart service API ───────────────────────────────────────────────────────────
case "$SERVICE_MGR" in
  systemd)
    log "systemctl restart $API_SERVICE"
    sudo systemctl restart "$API_SERVICE"
    ;;
  pm2)
    log "pm2 reload $API_SERVICE (hoặc start nếu chưa có)"
    pm2 reload "$API_SERVICE" 2>/dev/null \
      || pm2 start "$APP_DIR/apps/api/dist/main.js" --name "$API_SERVICE" --cwd "$APP_DIR/apps/api"
    pm2 save || true
    ;;
  none)
    warn "SERVICE_MGR=none — tự khởi động lại API (vd: cd apps/api && node dist/main.js)."
    ;;
  *)
    err "SERVICE_MGR không hợp lệ: $SERVICE_MGR (systemd|pm2|none)"; exit 1 ;;
esac

# ── 6. Health check ──────────────────────────────────────────────────────────────────
if [ "$SERVICE_MGR" != "none" ]; then
  log "Health check: $HEALTH_URL"
  for i in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok "API healthy"; break; fi
    [ "$i" = 30 ] && { err "API không healthy sau ~60s — kiểm tra log service ($API_SERVICE)."; exit 1; }
    sleep 2
  done
fi

ok "DEPLOY HOÀN TẤT — $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
cat <<EOF

Còn lại (cấu hình hạ tầng, làm 1 lần — không nằm trong script này):
  • Frontend: các SPA đã build vào apps/*/dist. Trỏ nginx / static host vào từng dist,
    hoặc dùng Cloudflare Pages (xem scripts/windows/06-deploy-pages.ps1).
  • Service API: tạo systemd unit '$API_SERVICE' (ExecStart=node $APP_DIR/apps/api/dist/main.js,
    WorkingDirectory=$APP_DIR/apps/api) hoặc pm2 ecosystem — chỉ cần làm lần đầu.
  • TLS/reverse-proxy (nginx/Caddy) trước api.<domain> + auth.<domain> + các subdomain SPA.
EOF
