# shellcheck shell=bash
# scripts/lib/db-secrets.sh — NGUỒN DUY NHẤT lấy mật khẩu DB role cho các script bash.
#
# S6-SEC-ROTATE-1 (KI-043) — VÌ SAO FILE NÀY TỒN TẠI
# ────────────────────────────────────────────────────────────────────────────────────────────────
# Trước 2026-07-28, mỗi script tự mang một fallback literal kiểu `${OWNER_DB_PASSWORD:-changeme_dev_only}`.
# Repo PUBLIC + cụm PROD chạy đúng literal đó ⇒ mọi "giá trị mặc định cho tiện" là một chìa khoá thật.
# Tệ hơn: fallback im lặng ⇒ sau khi rotate, script vẫn chạy (nối bằng mật khẩu cũ) rồi mới đỏ ở tận
# trong ruột, không ai lần ra nguyên nhân.
#
# Từ nay: KHÔNG literal, KHÔNG fallback im lặng. Thiếu secret ⇒ DỪNG với thông báo chỉ rõ phải làm gì.
#
# Dùng:
#   . "$(dirname "$0")/lib/db-secrets.sh"
#   db_secrets_load                      # nạp từ .env (không tracked) — biến env sẵn có THẮNG
#   db_secrets_require SUPERUSER_DB_PASSWORD
#
# Thứ tự tìm file env: $MEDIAOS_ENV_FILE > <cwd>/.env > <gốc repo suy từ vị trí file này>/.env
# (worktree lane thường KHÔNG có .env — đó là lý do có $MEDIAOS_ENV_FILE, xem memory
#  worktree-missing-kek-false-red).

# Đọc một khoá từ file .env phẳng `KEY=VALUE` (bỏ qua comment). In giá trị ra stdout, rỗng nếu không có.
_db_secrets_read_key() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" "$file" | head -n 1 | sed 's/[[:space:]]*$//'
}

# Lấy mật khẩu từ phần userinfo của một connection string postgres://user:pass@host/db.
#
# PHẢI percent-decode: trong URL, mật khẩu chứa ký tự đặc biệt được mã hoá (`p@ss` → `p%40ss`).
# Client `pg` decode trước khi gửi, nên nếu ở đây trả nguyên `p%40ss` thì lane test/migrate nối bằng
# MỘT MẬT KHẨU KHÁC với API — lệch âm thầm, chỉ lộ ra bằng "password authentication failed" khó truy.
# Cũng bóc nháy: một số người quote giá trị trong .env.
_db_secrets_pw_from_url() {
  local url="$1"
  case "$url" in
    *://*:*@*) : ;;
    *) return 0 ;;
  esac
  local rest="${url#*://}"
  local userinfo="${rest%%@*}"
  local pw="${userinfo#*:}"
  pw="${pw%\"}"; pw="${pw#\"}"; pw="${pw%\'}"; pw="${pw#\'}"
  # %XX → ký tự. printf '%b' hiểu \xNN.
  printf '%b' "$(printf '%s' "$pw" | sed -e 's/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')"
}

# Nạp các biến mật khẩu DB từ file .env nếu chúng CHƯA có trong môi trường.
# Precedence khớp apps/api/src/config/load-env.ts: env thật THẮNG file.
db_secrets_load() {
  local self_dir root env_file k v
  self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  root="$(cd "$self_dir/../.." && pwd)"

  for env_file in "${MEDIAOS_ENV_FILE:-}" "$PWD/.env" "$root/.env"; do
    [ -n "$env_file" ] && [ -f "$env_file" ] && break
    env_file=""
  done
  [ -n "$env_file" ] || return 0

  # CHỈ export biến MẬT KHẨU. TUYỆT ĐỐI KHÔNG export DATABASE_*_URL.
  #
  # ⚠ Bản đầu của file này có `DATABASE_DIRECT_URL` trong danh sách và HÀNG RÀO KI-028 BẮT ĐƯỢC NGAY
  #   (2026-07-28): `.env` trỏ DB PROD `mediaos`, nên chỉ cần `harness/check.sh` source file này là cả
  #   suite test nhận một URL tường minh trỏ PROD — mà URL tường minh THẮNG `LANE_DB`. Đó đúng là
  #   vector V2 của KI-028, tái sinh từ một tiện ích tưởng như vô hại.
  #   ⇒ Luật: helper này chỉ cấp MẬT KHẨU; ĐÍCH (database nào) do người gọi quyết định, không bao giờ
  #     do file .env lén quyết định hộ.
  for k in SUPERUSER_DB_PASSWORD OWNER_DB_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD \
           PGBOUNCER_AUTH_PASSWORD; do
    if [ -z "${!k:-}" ]; then
      v="$(_db_secrets_read_key "$env_file" "$k")"
      [ -n "$v" ] && export "$k=$v"
    fi
  done

  # `mediaos` (SUPERUSER) thường KHÔNG có biến riêng trong .env — mật khẩu của nó nằm trong
  # DATABASE_DIRECT_URL. Suy ra thay vì bắt người dùng khai trùng lặp (hai chỗ = hai chỗ lệch nhau).
  # Đọc vào biến CỤC BỘ: lấy được mật khẩu mà KHÔNG mang theo cái đích PROD đi cùng.
  if [ -z "${SUPERUSER_DB_PASSWORD:-}" ]; then
    local direct_url
    direct_url="${DATABASE_DIRECT_URL:-$(_db_secrets_read_key "$env_file" DATABASE_DIRECT_URL)}"
    if [ -n "$direct_url" ]; then
      v="$(_db_secrets_pw_from_url "$direct_url")"
      [ -n "$v" ] && export "SUPERUSER_DB_PASSWORD=$v"
    fi
  fi
}

# DỪNG nếu thiếu bất kỳ biến nào được liệt kê. Fail-closed, có hướng dẫn — không đoán, không im lặng.
db_secrets_require() {
  local missing="" k
  for k in "$@"; do
    [ -z "${!k:-}" ] && missing="$missing $k"
  done
  [ -z "$missing" ] && return 0

  cat >&2 <<EOF
[db-secrets] ⛔ THIẾU secret:$missing

  Mật khẩu DB KHÔNG còn giá trị mặc định trong repo (S6-SEC-ROTATE-1 / KI-043 — repo PUBLIC,
  literal cũ CHÍNH LÀ mật khẩu cụm PROD nên đã bị gỡ và rotate).

  Cách xử lý:
    • Máy có .env  : chạy lệnh từ gốc repo, hoặc export MEDIAOS_ENV_FILE=/duong/dan/.env
    • Worktree lane: cp "<gốc repo>/.env" .   (hoặc dùng MEDIAOS_ENV_FILE như trên)
    • CI           : khai secret trong workflow env
EOF
  return 1
}
