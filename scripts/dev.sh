#!/usr/bin/env bash
# scripts/dev.sh — Tiện ích DEV local cho MediaOS (rebuild + test nhanh).
# Chạy từ Git Bash (Windows) hoặc Linux/WSL:
#   bash scripts/dev.sh <lệnh> [tham số]
#
# Bổ trợ cho dev/dev.bat (menu Windows). Mọi lệnh chỉ wrap pnpm/turbo + harness có sẵn (không reinvent).

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

c_b=$'\033[36m'; c_g=$'\033[32m'; c_y=$'\033[33m'; c_r=$'\033[31m'; c_0=$'\033[0m'
log()  { printf '%s\n' "${c_b}▶ $*${c_0}"; }
ok()   { printf '%s\n' "${c_g}✓ $*${c_0}"; }
warn() { printf '%s\n' "${c_y}! $*${c_0}"; }
err()  { printf '%s\n' "${c_r}✗ $*${c_0}" >&2; }

usage() {
  cat <<'EOF'
MediaOS dev — bash scripts/dev.sh <lệnh> [tham số]

  setup             cp .env.example .env (nếu thiếu) + pnpm install
  install           pnpm install
  up | down         bật / tắt infra docker (postgres · pgbouncer · valkey · minio)
  migrate           áp migration (pnpm db:migrate)
  seed              seed công ty demo + dữ liệu (apps/api/demo-seed-*.mjs)
  build             pnpm build (turbo: contracts + api + web + các app)
  rebuild           pnpm install + pnpm build
  clean             xoá node_modules · dist · .turbo (rebuild sạch hoàn toàn)
  test [app] [pat]  vitest 1 app (vd: test api permission). Không app → chạy check
  lint | typecheck  pnpm lint / pnpm typecheck
  check [args]      harness/check.sh = lint + typecheck + test  ([--no-test] [--smoke])
  dev               pnpm dev (turbo: api + web ... song song)
  reset             [XOÁ SẠCH DATA] down -v + up + migrate + setup-roles + seed
  help              bảng này

Ví dụ:  bash scripts/dev.sh rebuild   ·   bash scripts/dev.sh test auth   ·   bash scripts/dev.sh check --no-test
EOF
}

# Nạp .env vào môi trường (robust: tách trên '=' đầu tiên, bỏ comment, strip CR của CRLF Windows).
load_env() {
  local file="${1:-.env}" k v
  [ -f "$file" ] || return 0
  while IFS='=' read -r k v || [ -n "$k" ]; do
    k="${k%$'\r'}"; v="${v%$'\r'}"
    case "$k" in ''|\#*) continue ;; esac
    export "$k=$v"
  done < "$file"
}

wait_pg() {
  log "Chờ Postgres sẵn sàng..."
  local i
  for i in $(seq 1 30); do
    docker exec mediaos-postgres pg_isready -U mediaos >/dev/null 2>&1 && { ok "Postgres ready"; return 0; }
    sleep 1
  done
  err "Postgres không sẵn sàng sau 30s"; return 1
}

seed() { ( cd "$ROOT/apps/api" && node demo-seed-base.mjs && node demo-seed-full.mjs ); }

cmd="${1:-help}"; [ $# -gt 0 ] && shift

case "$cmd" in
  setup)
    if [ ! -f .env ]; then cp .env.example .env && ok "Tạo .env từ .env.example"; fi
    pnpm install ;;
  install)   pnpm install ;;
  up)        pnpm db:up ;;
  down)      pnpm db:down ;;
  migrate)   pnpm db:migrate ;;
  seed)      seed && ok "Seed xong" ;;
  build)     pnpm build ;;
  rebuild)   log "install + build"; pnpm install && pnpm build && ok "Rebuild xong" ;;
  clean)
    warn "Xoá node_modules / dist / .turbo ..."
    rm -rf node_modules apps/*/node_modules packages/*/node_modules
    rm -rf apps/*/dist packages/*/dist .turbo apps/*/.turbo packages/*/.turbo
    ok "Đã clean. Tiếp: bash scripts/dev.sh setup" ;;
  test)
    app="${1:-}"; [ $# -gt 0 ] && shift; pat="${*:-}"
    if [ -z "$app" ]; then warn "Không truyền app → chạy full check"; exec bash harness/check.sh; fi
    dir=""
    [ -f "apps/$app/package.json" ]     && dir="apps/$app"
    [ -f "packages/$app/package.json" ] && dir="packages/$app"
    [ -n "$dir" ] || { err "Không thấy app/package: $app"; exit 1; }
    log "Test $app ($dir) ${pat:+— lọc: $pat}"
    # vitest TRỰC TIẾP trong thư mục app (turbo nuốt env → fail giả — xem dev/README.md).
    ( cd "$dir" && pnpm exec vitest run $pat ) ;;
  lint)      pnpm lint ;;
  typecheck) pnpm typecheck ;;
  check)     exec bash harness/check.sh "$@" ;;
  dev)       pnpm dev ;;
  reset)
    warn "RESET sẽ XOÁ SẠCH mọi dữ liệu docker (postgres · minio · valkey volume). Không hoàn tác."
    printf 'Gõ "reset" để xác nhận: '; read -r ans
    [ "$ans" = "reset" ] || { warn "Huỷ."; exit 0; }
    if [ -f .env.dev ]; then cp .env.dev .env && ok ".env.dev → .env (DEV flat-localhost)"; fi
    log "docker compose down -v (xoá volume)"; docker compose down -v
    log "infra up";                            pnpm db:up
    wait_pg || exit 1
    log "migrate (tạo schema + role)";         pnpm db:migrate
    log "setup DB role passwords (changeme_* từ .env)"; load_env .env; pnpm db:setup-roles
    log "seed demo";                           seed
    ok "RESET xong: DB sạch + migrate + role + seed" ;;
  help|--help|-h) usage ;;
  *) err "Lệnh không hợp lệ: $cmd"; echo; usage; exit 1 ;;
esac
