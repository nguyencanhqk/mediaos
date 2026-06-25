#!/usr/bin/env bash
# seed1-red-evidence.sh — RED-before-GREEN artifact generator cho S2-AUTH-SEED-1 (mig 0444).
#
# VÌ SAO: acceptance "Lưu bằng chứng RED" yêu cầu một ARTIFACT TÁI LẬP ĐƯỢC (script + output capture),
#   KHÔNG phải prose trong commit message. Script này chạy 2 suite integration của WO:
#     • test/integration/auth-seed-canonical-roles.int-spec.ts
#     • test/integration/super-admin-bootstrap.int-spec.ts
#   trên HAI DB cô lập:
#     1) RED  = chain 0000→0443 (KHÔNG áp 0444) → thiếu cặp §13 (view:me, view-sensitive:employee…)
#               + scope SAI ⇒ suite ĐỎ (N FAIL).
#     2) GREEN = chain 0000→0444 (áp seed canonical) ⇒ suite XANH (N PASS).
#   rồi GHÉP output thật (fail count + tên test fail + pass count) vào file evidence committable.
#
# CÁCH ÁP CHỈ ĐẾN 0443 (KHÔNG 0444) MÀ KHÔNG sửa journal gốc: dựng một thư mục migrations TẠM
#   (symlink/copy) với meta/_journal.json bị CẮT đến idx 126 — drizzle migrator chỉ áp các tag có trong
#   journal ⇒ 0444 bị bỏ. Thư mục gốc apps/api/migrations KHÔNG bị đụng.
#
# CHẠY (từ worktree lane, cần Docker Postgres mediaos-postgres up):
#   bash apps/api/scripts/seed1-red-evidence.sh
# Tham số (env, có default):
#   PG_CONTAINER=mediaos-postgres  PG_SUPERUSER=mediaos  PG_HOSTPORT=localhost:5432
#   OWNER_DB_PASSWORD=changeme_dev_only
#   RED_DB=mediaos_authseed1red    GREEN_DB=mediaos_authseed1green
#   EVIDENCE_FILE=docs/QA/evidence/S2-AUTH-SEED-1-RED-before-GREEN.txt
set -euo pipefail

# ── Resolve repo paths (script ở apps/api/scripts → repo root = ../../..) ─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"            # apps/api
REPO_DIR="$(cd "$API_DIR/../.." && pwd)"           # repo root (worktree)

PG_CONTAINER="${PG_CONTAINER:-mediaos-postgres}"
SUPER="${PG_SUPERUSER:-mediaos}"
HOSTPORT="${PG_HOSTPORT:-localhost:5432}"
DEV_PW="${OWNER_DB_PASSWORD:-changeme_dev_only}"
RED_DB="${RED_DB:-mediaos_authseed1red}"
GREEN_DB="${GREEN_DB:-mediaos_authseed1green}"
SUITES="test/integration/auth-seed-canonical-roles.int-spec.ts test/integration/super-admin-bootstrap.int-spec.ts"
EVIDENCE_FILE="${EVIDENCE_FILE:-docs/QA/evidence/S2-AUTH-SEED-1-RED-before-GREEN.txt}"
EVIDENCE_PATH="$REPO_DIR/$EVIDENCE_FILE"

psql_super() { docker exec -i "$PG_CONTAINER" psql -U "$SUPER" -d postgres -v ON_ERROR_STOP=1 "$@"; }

# ── Tạo lại sạch 1 DB cô lập (DROP nếu có → CREATE) ──────────────────────────────────────────────
reset_db() {
  local db="$1"
  psql_super -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db}' AND pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  psql_super -c "DROP DATABASE IF EXISTS ${db}" >/dev/null
  psql_super -c "CREATE DATABASE ${db} OWNER ${SUPER}" >/dev/null
}

# ── Dựng thư mục migrations TẠM với journal cắt đến idx <maxIdx> (loại tag idx > maxIdx) ──────────
# In ra đường dẫn thư mục tạm (caller chịu trách nhiệm rm -rf).
build_truncated_migrations() {
  local maxIdx="$1"
  local tmp
  tmp="$(mktemp -d)"
  cp -r "$API_DIR/migrations/." "$tmp/"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const maxIdx = parseInt(process.argv[2], 10);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const before = j.entries.length;
    j.entries = j.entries.filter((e) => e.idx <= maxIdx);
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
    process.stderr.write(`[truncate] journal ${before} → ${j.entries.length} entries (max idx ${maxIdx})\n`);
  ' "$tmp/meta/_journal.json" "$maxIdx"
  echo "$tmp"
}

# ── Migrate <db> dùng <migrationsFolder> qua drizzle migrator (migrate.ts) ────────────────────────
migrate_into() {
  local db="$1"
  local folder="$2"
  ( cd "$API_DIR" && DATABASE_DIRECT_URL="postgres://${SUPER}:${DEV_PW}@${HOSTPORT}/${db}" \
      MIGRATIONS_FOLDER="$folder" \
      pnpm --silent exec tsx scripts/_migrate-from.ts )
}

# ── Strip ANSI escape codes (CSI sequences) cho artifact sạch, diff-được, CI-readable ────────────
strip_ansi() { sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g'; }

# ── Chạy 2 suite trên <db>, in vitest output (đã strip ANSI) ra stdout (KHÔNG fail script khi đỏ) ─
# NO_COLOR/FORCE_COLOR=0 ép vitest không tô màu; strip_ansi quét nốt escape còn sót (vd reporter spinner).
run_suites() {
  local db="$1"
  ( cd "$API_DIR" \
      && NO_COLOR=1 FORCE_COLOR=0 LANE_DB="$db" PG_HOSTPORT="$HOSTPORT" \
         pnpm --silent exec vitest run $SUITES --reporter=default --no-color 2>&1 ) | strip_ansi || true
}

# ── Trích con số "X passed / Y failed" + tên test fail từ vitest output ───────────────────────────
extract_summary() {
  grep -E "Tests +[0-9]+|Test Files +[0-9]+|^\s*(×|✓|FAIL|✗|↓)" "$1" | grep -vE "ms$" || true
}

echo "════════════════════════════════════════════════════════════════════════════════════"
echo " S2-AUTH-SEED-1 — RED-before-GREEN evidence generator"
echo "   RED   DB = $RED_DB   (chain 0000→0443, KHÔNG áp 0444)"
echo "   GREEN DB = $GREEN_DB (chain 0000→0444)"
echo "   suites  = $SUITES"
echo "   output  → $EVIDENCE_FILE"
echo "════════════════════════════════════════════════════════════════════════════════════"

# Preflight: container phải up.
if ! docker exec -i "$PG_CONTAINER" psql -U "$SUPER" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "✗ Postgres container '$PG_CONTAINER' không sẵn sàng — chạy 'pnpm db:up' trước." >&2
  exit 1
fi

RED_MIGR=""; GREEN_MIGR=""
cleanup() { [ -n "$RED_MIGR" ] && rm -rf "$RED_MIGR"; [ -n "$GREEN_MIGR" ] && rm -rf "$GREEN_MIGR"; }
trap cleanup EXIT

# ── (1) RED: migrate 0000→0443 (journal cắt idx≤126) → chạy suite ────────────────────────────────
echo ">> [RED] reset + migrate 0000→0443 ($RED_DB)…"
reset_db "$RED_DB"
RED_MIGR="$(build_truncated_migrations 126)"
migrate_into "$RED_DB" "$RED_MIGR"
echo ">> [RED] run suites…"
RED_OUT="$(run_suites "$RED_DB")"

# ── (2) GREEN: migrate 0000→0444 (journal đầy đủ) → chạy suite ────────────────────────────────────
echo ">> [GREEN] reset + migrate 0000→0444 ($GREEN_DB)…"
reset_db "$GREEN_DB"
GREEN_MIGR="$(build_truncated_migrations 127)"   # idx≤127 = full (gồm 0444)
migrate_into "$GREEN_DB" "$GREEN_MIGR"
echo ">> [GREEN] run suites…"
GREEN_OUT="$(run_suites "$GREEN_DB")"

# ── (3) Ghép evidence file ───────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$EVIDENCE_PATH")"
{
  echo "S2-AUTH-SEED-1 — RED-before-GREEN evidence (canonical roles + per-pair data_scope §13)"
  echo "Generated by: apps/api/scripts/seed1-red-evidence.sh"
  echo "Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "Suites: auth-seed-canonical-roles.int-spec.ts + super-admin-bootstrap.int-spec.ts"
  echo "Gate: hasDb && LANE_DB (DB cô lập, KHÔNG chạm DB dev chung 'mediaos')."
  echo ""
  echo "Cách tái lập: pnpm db:up && bash apps/api/scripts/seed1-red-evidence.sh"
  echo "═════════════════════════════════════════════════════════════════════════════════════"
  echo ""
  echo "########################################################################################"
  echo "# (1) CHAIN 0000→0443  (KHÔNG áp 0444)  →  EXPECTED: RED (N FAIL)                       #"
  echo "#     Lý do RED: catalog THIẾU cặp §13 (view:me, view:user, lock:user, view:role,       #"
  echo "#     view:permission, view-sensitive:employee, create/approve:profile-change-request,  #"
  echo "#     change-status/export:employee) + role manager/hr CHƯA seed + per-pair data_scope  #"
  echo "#     §13 chưa tồn tại (vd view:me=Own ×4 role, read:employee manager=Team).            #"
  echo "########################################################################################"
  echo ""
  echo "$RED_OUT"
  echo ""
  echo "----- [RED] tóm tắt (vitest summary) -----------------------------------------------------"
  printf '%s\n' "$RED_OUT" | extract_summary /dev/stdin
  echo ""
  echo ""
  echo "########################################################################################"
  echo "# (2) CHAIN 0000→0444  (áp seed canonical 0444)  →  EXPECTED: GREEN (N PASS)            #"
  echo "#     Sau 0444: catalog đủ cặp §13 + manager/hr seeded + per-pair data_scope §13 đúng.   #"
  echo "########################################################################################"
  echo ""
  echo "$GREEN_OUT"
  echo ""
  echo "----- [GREEN] tóm tắt (vitest summary) ---------------------------------------------------"
  printf '%s\n' "$GREEN_OUT" | extract_summary /dev/stdin
  echo ""
  echo "═════════════════════════════════════════════════════════════════════════════════════"
  echo "KẾT LUẬN: RED (0443) FAIL → GREEN (0444) PASS chứng minh 0444 là nguyên nhân GREEN."
  echo "Đây là artifact TÁI LẬP ĐƯỢC (script + output capture), KHÔNG phải commit-message text."
} > "$EVIDENCE_PATH"

echo ""
echo "✅ Evidence ghi vào: $EVIDENCE_FILE"
echo "----- RED summary -----";   printf '%s\n' "$RED_OUT"   | extract_summary /dev/stdin
echo "----- GREEN summary -----"; printf '%s\n' "$GREEN_OUT" | extract_summary /dev/stdin
