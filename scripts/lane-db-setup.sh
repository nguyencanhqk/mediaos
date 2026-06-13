#!/usr/bin/env bash
# lane-db-setup.sh — tạo + chain-migrate một DB CÔ LẬP cho 1 lane song song.
#
# VÌ SAO: mô hình parallel-lanes mở nhiều dòng-thời-gian migration cùng lúc. drizzle migrator
# áp migration ĐƠN ĐIỆU theo `when`: một khi lane band cao (vd G8 `0080s`) migrate lên DB DÙNG CHUNG,
# mọi migration band thấp hơn (G10 `0050`, G11 `0060s`, G13 `0070s`) bị SKIP vĩnh viễn trên DB đó.
# → Mỗi lane PHẢI có DB riêng `mediaos_<lane>` để chain `0000→latest` của nó luôn áp SẠCH.
# (xem memory: mediaos-shared-db-drift-parallel-lanes)
#
# CHẠY TỪ worktree của lane (cwd = gốc worktree) để pnpm dùng migration band của chính lane đó:
#   cd "c:/dev 2/mediaos-g13-finance" && bash "../MediaOS/scripts/lane-db-setup.sh" g13
#   ... thêm --reset để DROP + tạo lại sạch:
#   bash "../MediaOS/scripts/lane-db-setup.sh" g13 --reset
#
# Sau khi xong, export biến nó in ra rồi chạy test:
#   export LANE_DB=mediaos_g13 && pnpm --filter @mediaos/api test
set -euo pipefail

LANE="${1:?Usage: lane-db-setup.sh <lane> [--reset]   (vd: g13)}"
RESET="${2:-}"
DB="mediaos_${LANE}"
CONTAINER="${PG_CONTAINER:-mediaos-postgres}"     # tên container Postgres (docker-compose)
SUPER="${PG_SUPERUSER:-mediaos}"                  # superuser/owner role (cluster-global, đã có)
HOSTPORT="${PG_HOSTPORT:-localhost:5432}"         # cổng map ra host cho pnpm db:migrate
DEV_PW="${OWNER_DB_PASSWORD:-changeme_dev_only}"  # mật khẩu dev của superuser mediaos

psql_super() { docker exec -i "$CONTAINER" psql -U "$SUPER" -d postgres -v ON_ERROR_STOP=1 "$@"; }

exists="$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" | tr -d '[:space:]' || true)"

if [ "$RESET" = "--reset" ] && [ "$exists" = "1" ]; then
  echo "[lane-db] --reset → DROP DATABASE ${DB} (ngắt mọi kết nối trước)"
  psql_super -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB}' AND pid <> pg_backend_pid()" >/dev/null
  psql_super -c "DROP DATABASE IF EXISTS ${DB}"
  exists=""
fi

if [ "$exists" != "1" ]; then
  echo "[lane-db] CREATE DATABASE ${DB} OWNER ${SUPER}"
  psql_super -c "CREATE DATABASE ${DB} OWNER ${SUPER}"
else
  echo "[lane-db] ${DB} đã tồn tại — chỉ chain-migrate (dùng --reset để làm lại từ đầu)"
fi

echo "[lane-db] chain migrate 0000→latest vào ${DB} (dùng migration của worktree cwd: $(pwd))"
# migrate.ts chỉ cần DATABASE_DIRECT_URL; loadEnv() có default cho mọi field khác → không cần .env.
DATABASE_DIRECT_URL="postgres://${SUPER}:${DEV_PW}@${HOSTPORT}/${DB}" \
  pnpm --filter @mediaos/api db:migrate

cat <<EOF

[lane-db] ✅ ${DB} sẵn sàng (chain 0000→latest áp sạch).
   Export trước khi chạy test/app TRONG worktree lane này:

     export LANE_DB=${DB}
     pnpm --filter @mediaos/api test

   (vitest.config.ts đọc LANE_DB → trỏ DATABASE_URL/DIRECT_URL/WORKER_URL sang ${DB}, hết drift cross-lane.)
EOF
