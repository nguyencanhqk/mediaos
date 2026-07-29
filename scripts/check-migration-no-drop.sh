#!/usr/bin/env bash
# check-migration-no-drop.sh — CHỐT của S6-PERF-DB-1 cho IMPLEMENTATION-09 §15.5 ("không drop
# column/table trong cùng release" · dùng expand/contract) + §15.6.7 ("migration có lệnh destructive
# chưa được approval ⇒ KHÔNG go-live").
#
# ─────────────────────────────────────────────────────────────────────────────────────────────
# VÌ SAO QUÉT MIGRATION SQL CHỨ KHÔNG PHẢI `db:generate` (đọc kỹ trước khi "cải tiến")
#
# done_when của WO ghi "Không db:generate drop", và cách hiển nhiên là chạy `db:generate` rồi soi
# diff. ĐÃ THỬ NGÀY 2026-07-29 VÀ NÓ VÔ NGHĨA — chứng minh bằng phép thử ĐỎ:
#   · Xoá hẳn một cột khỏi schema TS (`system-jobs.ts::durationMs`) rồi chạy generate
#     ⇒ diff KHÔNG hề có `DROP COLUMN`, script vẫn XANH.
#   · Lý do: `migrations/meta/` chỉ có ĐÚNG 1 snapshot (`0000_snapshot.json`) cho 201 migration —
#     toàn bộ migration từ 0001 trở đi là VIẾT TAY, drizzle-kit không thấy. Nên baseline diff của nó
#     gần như RỖNG ⇒ generate luôn sinh "tạo lại cả thế giới" (148 CREATE TABLE, 483 CREATE INDEX,
#     527 ALTER…ADD, 0 DROP) và KHÔNG BAO GIỜ sinh nổi một lệnh DROP.
#   · Một chốt không thể ĐỎ thì tệ hơn không có chốt: nó chế ra sự yên tâm giả.
#
# Điểm kiểm soát THẬT là chính file migration viết tay — nơi một lệnh phá huỷ thực sự có thể lọt vào.
# Đó là thứ script này quét.
# ─────────────────────────────────────────────────────────────────────────────────────────────
#
# PHẠM VI QUÉT — hẹp CÓ CHỦ Ý: `DROP TABLE` · `DROP COLUMN` · `TRUNCATE` · `DROP SCHEMA`.
# KHÔNG quét `DROP CONSTRAINT` / `DROP INDEX` / `DROP POLICY` vì trong repo này chúng là **thành ngữ
# THAY THẾ hợp lệ**, không phải phá huỷ:
#   · `DROP CONSTRAINT audit_logs_object_type_chk` rồi ADD lại = đúng luật UNION-ADD của CHECK
#     audit `object_types` (CLAUDE.md §9.3) — xuất hiện ở ~30 migration. Bắt đỏ ở đây là chuông reo
#     liên tục ⇒ người ta tắt chốt ⇒ mất luôn cả phần có ích.
#   · `DROP INDEX`/`DROP POLICY` đi kèm CREATE lại ngay dưới (0221, 0230).
# Muốn siết thêm 3 loại đó thì phải kèm cơ chế nhận diện "replace" — chưa làm, đừng mở rộng regex trần.
#
# NGOẠI LỆ CÓ ĐĂNG KÝ: 2 file di sản dưới đây (kỷ nguyên media/payroll đã park) — đã deploy từ lâu,
# không sửa lại được, và KHÔNG thuộc phạm vi sản phẩm hiện tại.
# Migration MỚI muốn phá huỷ ⇒ phải ghi dòng chuẩn thuận ngay TRONG file (§15.2 "có người chịu trách
# nhiệm approve migration"):   -- DESTRUCTIVE-APPROVED: <lý do> (<người duyệt>)
#
# Exit 0 = không có lệnh phá huỷ chưa đăng ký. Exit 1 = có.

set -Eeuo pipefail

log()  { printf '[no-drop %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "FAIL: $*" >&2; exit 1; }
ok()   { log "OK: $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="${MIG_DIR:-$SCRIPT_DIR/../apps/api/migrations}"

[[ -d "$MIG_DIR" ]] || fail "không thấy thư mục migration: $MIG_DIR"

DESTRUCTIVE_RE='DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|TRUNCATE[[:space:]]|DROP[[:space:]]+SCHEMA'
APPROVAL_RE='DESTRUCTIVE-APPROVED:'

# Di sản đã deploy (park) — xem khối chú thích trên. KHÔNG thêm file mới vào đây thay cho việc
# xin approval: dòng DESTRUCTIVE-APPROVED trong chính file mới là đường đi đúng.
BASELINE="0025_g6_content_items_full.sql 0130_g12_period_approval_fsm.sql"

la_baseline() {
  local ten="$1" b
  for b in $BASELINE; do [[ "$ten" == "$b" ]] && return 0; done
  return 1
}

VI_PHAM=""
SO_BASELINE=0
SO_DUYET=0
SO_QUET=0

for f in "$MIG_DIR"/*.sql; do
  [[ -e "$f" ]] || continue
  SO_QUET=$((SO_QUET + 1))
  ten="$(basename "$f")"
  # Bỏ comment SQL (`--`) TRƯỚC khi quét: repo này ghi rất nhiều "-- Down: DROP TABLE …" như tài
  # liệu rollback. Đó là văn bản, không phải lệnh chạy — bắt đỏ chúng là đỏ oan hàng loạt.
  hits="$(sed -E 's/--.*$//' "$f" | grep -nEi "$DESTRUCTIVE_RE" || true)"
  [[ -z "$hits" ]] && continue

  if la_baseline "$ten"; then
    SO_BASELINE=$((SO_BASELINE + 1))
    continue
  fi
  # Chuẩn thuận tường minh trong chính file (đọc bản GỐC, kể cả dòng comment — marker LÀ comment).
  if grep -qE "$APPROVAL_RE" "$f"; then
    SO_DUYET=$((SO_DUYET + 1))
    log "ĐÃ DUYỆT: $ten — $(grep -oE "$APPROVAL_RE.*" "$f" | head -1)"
    continue
  fi

  VI_PHAM="$VI_PHAM
=== $ten ===
$hits"
done

if [[ -n "$VI_PHAM" ]]; then
  log "❌ migration có lệnh PHÁ HUỶ chưa đăng ký:" >&2
  printf '%s\n' "$VI_PHAM" >&2
  cat >&2 <<'HD'

  §15.5 yêu cầu expand/contract: KHÔNG drop column/table trong cùng release với code còn dùng nó.
  Cửa sổ 403/500 sinh ra đúng ở đây (xem memory `migration-expand-contract-required`).

  Nếu ĐÚNG là cần phá huỷ và đã tách release + có người chịu trách nhiệm duyệt (§15.2), thêm dòng
  này vào chính file migration:

      -- DESTRUCTIVE-APPROVED: <lý do ngắn> (<người duyệt>)

HD
  fail "$(printf '%s' "$VI_PHAM" | grep -c '^=== ') file vi phạm"
fi

ok "quét $SO_QUET migration — 0 lệnh phá huỷ chưa đăng ký (baseline di sản: $SO_BASELINE · đã duyệt tường minh: $SO_DUYET)"
