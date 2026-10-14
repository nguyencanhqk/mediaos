#!/usr/bin/env bash
# storage-r2-compat.sh — chạy các int-spec storage của API trên bucket Cloudflare R2 THỬ (S19-OPS-STORAGEPUBLIC-1).
#
# VÌ SAO: storage PROD là R2 nhưng CI + lane chạy storage tự host ⇒ CI KHÔNG BAO GIỜ chứng minh tương thích
# R2. Một lần nâng `@aws-sdk/*` có thể làm hỏng ký URL / ghi / xoá trên R2 trong khi CI vẫn xanh.
# LUẬT (DEVOPS-03 §13.5): chạy lệnh này TRƯỚC lần chuyển PROD và TRƯỚC MỖI lần nâng `@aws-sdk/*`.
#
# CHẠY TỪ gốc worktree, trên một lane DB cô lập (không bao giờ trên DB dùng chung / PROD):
#   bash scripts/lane-db-setup.sh <lane>
#   LANE_DB=mediaos_<lane> bash scripts/storage-r2-compat.sh "<đường dẫn file cấu hình R2>"
#
# File cấu hình (NGOÀI kho, owner tạo — token «Object Read & Write» CHỈ cho bucket thử):
#   S3_ENDPOINT=https://<mã tài khoản>.r2.cloudflarestorage.com
#   S3_ACCESS_KEY=<32 hex>
#   S3_SECRET_KEY=<64 hex>
# Script KHÔNG `source` file, chỉ lấy đúng 3 khoá trên và kiểm bằng quy tắc dương; không in giá trị nào.
# Bucket luôn là bucket thử `mediaos-fdisp-test` (tên duy nhất `apps/api/test/helpers/storage-test-target.ts`
# cho ghi khi chạy cục bộ). Đặt TƯỜNG MINH đủ 6 biến `S3_*` ⇒ không biến nào lấy từ `.env` của máy.
#
# XANH = exit 0 VÀ log có dòng «ĐÃ TỒN TẠI — ca storage thật CHẠY» của CẢ HAI int-spec (không phải «BỎ QUA»).
# Log đầy đủ: $R2_COMPAT_LOG (mặc định một file tạm ngoài kho) — có thể chứa URL ký của bucket thử, đừng chép vào kho.
set -uo pipefail

CONF="${1:?Usage: LANE_DB=mediaos_<lane> bash scripts/storage-r2-compat.sh <file cấu hình R2>}"
[ -f "$CONF" ] || { echo "không thấy file cấu hình: $CONF"; exit 2; }
[ -n "${LANE_DB:-}" ] || { echo "thiếu LANE_DB — chạy scripts/lane-db-setup.sh <lane> rồi export LANE_DB=mediaos_<lane>"; exit 2; }
[ -f scripts/lib/db-secrets.sh ] || { echo "chạy từ gốc worktree (không thấy scripts/lib/db-secrets.sh)"; exit 2; }

conf_get() {
  grep -m1 -E "^[[:space:]]*$1[[:space:]]*=" "$CONF" | cut -d= -f2- | tr -d '\r' |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
endpoint="$(conf_get S3_ENDPOINT)"
endpoint="${endpoint%/}"
access="$(conf_get S3_ACCESS_KEY)"
secret="$(conf_get S3_SECRET_KEY)"
bad=0
printf '%s' "$endpoint" | grep -qE '^https://[0-9a-f]{32}(\.eu|\.fedramp)?\.r2\.cloudflarestorage\.com$' ||
  { echo "S3_ENDPOINT không đúng dạng https://<32 hex>.r2.cloudflarestorage.com (dài ${#endpoint} ký tự)"; bad=1; }
printf '%s' "$access" | grep -qE '^[0-9a-f]{32}$' || { echo "S3_ACCESS_KEY không đúng dạng 32 hex (dài ${#access})"; bad=1; }
printf '%s' "$secret" | grep -qE '^[0-9a-f]{64}$' || { echo "S3_SECRET_KEY không đúng dạng 64 hex (dài ${#secret})"; bad=1; }
[ "$bad" = 0 ] || exit 6

# shellcheck source=lib/db-secrets.sh
. scripts/lib/db-secrets.sh
db_secrets_load
db_secrets_require SUPERUSER_DB_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD || { echo "không nạp được mật khẩu DB"; exit 4; }
export SUPERUSER_DB_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD
# URL tường minh THẮNG LANE_DB và sẽ đưa test sang DB khác lane ⇒ luôn bỏ.
unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL
export S3_ENDPOINT="$endpoint" S3_ACCESS_KEY="$access" S3_SECRET_KEY="$secret"
export S3_BUCKET="mediaos-fdisp-test" S3_REGION="auto" S3_FORCE_PATH_STYLE="true"

LOG="${R2_COMPAT_LOG:-$(mktemp -t storage-r2-compat.XXXXXX.log)}"
t0=$(date +%s)
pnpm --filter @mediaos/api exec vitest run \
  test/foundation/storage-provider.unit-spec.ts \
  test/integration/s16-filedisposition-storage.int-spec.ts \
  test/integration/s19-storage-provider-compat.int-spec.ts \
  --maxWorkers=1 --reporter=verbose >"$LOG" 2>&1
code=$?
echo "exit=$code · $(($(date +%s) - t0))s · lane=$LANE_DB · storage=R2 (bucket thử) · log=$LOG"
clean="$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | sed -E 's#https?://[^[:space:]"]+#<url>#g')"
echo "$clean" | grep -E 'ĐÃ TỒN TẠI|BỎ QUA|Test Files|Tests |AssertionError|Error: ' | head -40
ran="$(echo "$clean" | grep -c 'ĐÃ TỒN TẠI — ca storage thật CHẠY')"
if [ "$code" = 0 ] && [ "$ran" -lt 2 ]; then
  echo "KHÔNG ĐỦ BẰNG CHỨNG: chỉ $ran/2 int-spec báo ca storage thật CHẠY — xem các dòng BỎ QUA ở trên."
  exit 7
fi
exit $code
