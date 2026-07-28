#!/usr/bin/env bash
# guardproof-secret-literals.sh — LƯỚI HỒI QUY cho scripts/check-no-secret-literals.mjs.
#
# VÌ SAO TỒN TẠI (S6-SEC-ROTATE-1 / KI-043): cổng chống-literal đã hai lần "xanh" mà thực ra mù —
# vòng 1 lọt 6 dạng bind rộng, vòng 2 lọt thêm 10 dạng nữa CỘNG với việc không quét file chưa tracked.
# Cả hai lần đều chỉ lộ ra khi có người CỐ TÌNH dựng ca tấn công. Vì vậy lưới này là một phần của cổng,
# không phải công cụ dùng một lần: sửa luật trong check-no-secret-literals.mjs thì chạy lại file này.
#
#   bash scripts/guardproof-secret-literals.sh      (exit 0 = cả 27 ca đúng kỳ vọng)
#
# Mỗi ca dựng một repo git tạm rồi chạy cổng THẬT trên đó — không mock, không giả lập.
set -u
GUARD="$(cd "$(dirname "$0")" && pwd)/check-no-secret-literals.mjs"
BASE="${GUARDPROOF_TMP:-${TMPDIR:-/tmp}/mediaos-guardproof}"
rm -rf "$BASE"; mkdir -p "$BASE"

pass=0; fail=0

# run_case <tên> <expect: RED|GREEN> <thư mục con>
run_case() {
  local name="$1" expect="$2" dir="$3"
  ( cd "$dir" && git init -q . && git add -A >/dev/null 2>&1 )
  local out rc
  out="$(cd "$dir" && node "$GUARD" 2>&1)"; rc=$?
  local got="GREEN"; [ $rc -ne 0 ] && got="RED"
  if [ "$got" = "$expect" ]; then
    printf '  ✅ %-52s %s\n' "$name" "$got"; pass=$((pass+1))
  else
    printf '  ❌ %-52s mong %s, thực %s\n' "$name" "$expect" "$got"; fail=$((fail+1))
    printf '%s\n' "$out" | sed 's/^/       /' | head -6
  fi
}

mk() { mkdir -p "$BASE/$1"; }

# ── compose: 10 ca LỌT của vòng 2, tất cả publish 0.0.0.0 ⇒ PHẢI ĐỎ ────────────────────────────
mk c1; printf 'services:\n  a:\n    ports: ["0.0.0.0:15432:5432"]\n' > "$BASE/c1/docker-compose.yml"
run_case "flow-style [\"0.0.0.0:x:y\"]" RED "$BASE/c1"

mk c2; printf 'services:\n  a:\n    ports:\n    - "0.0.0.0:15433:5432"\n' > "$BASE/c2/docker-compose.yml"
run_case "seq CÙNG độ thụt với ports:" RED "$BASE/c2"

mk c3; printf 'services:\n  a:\n    ports:   # publish\n      - "0.0.0.0:15434:5432"\n' > "$BASE/c3/docker-compose.yml"
run_case "comment cuối dòng khoá ports:" RED "$BASE/c3"

mk c4; printf 'services:\n  a:\n    ports:\n      - dbhost:15435:5432\n' > "$BASE/c4/docker-compose.yml"
run_case "hostname bị nhận nhầm long-syntax" RED "$BASE/c4"

mk c5; printf 'services:\n  a:\n    ports: &shared\n      - "0.0.0.0:15436:5432"\n' > "$BASE/c5/docker-compose.yml"
run_case "anchor &shared" RED "$BASE/c5"

mk c6; printf 'x-p: &shared\n  - "0.0.0.0:1:2"\nservices:\n  a:\n    ports: *shared\n' > "$BASE/c6/docker-compose.yml"
run_case "alias *shared" RED "$BASE/c6"

mk c7; printf 'services:\n  a:\n    ports:\n      - "${BIND}:15437:5432"\n' > "$BASE/c7/docker-compose.yml"
run_case "\${BIND} KHÔNG có default" RED "$BASE/c7"

mk c8; printf '{"services": {"a": {"ports": ["0.0.0.0:15438:5432"]}}}\n' > "$BASE/c8/docker-compose.yml"
run_case "JSON-in-YAML" RED "$BASE/c8"

mk c9/infra; printf 'services:\n  a:\n    ports:\n      - "5432:5432"\n' > "$BASE/c9/infra/db-compose.yml"
run_case "tên file lạ: infra/db-compose.yml" RED "$BASE/c9"

mk c9b; printf 'services:\n  a:\n    ports:\n      - "5432:5432"\n' > "$BASE/c9b/stack.yml"
run_case "tên file lạ: stack.yml" RED "$BASE/c9b"

mk c10; printf 'services:\n  a:\n    network_mode: host\n' > "$BASE/c10/docker-compose.yml"
run_case "network_mode: host" RED "$BASE/c10"

mk c11; printf 'services:\n  a:\n    ports:\n      - target: 5432\n        published: 5439\n' > "$BASE/c11/docker-compose.yml"
run_case "long-syntax thiếu host_ip" RED "$BASE/c11"

mk c12; printf 'services:\n  a:\n    ports:\n      - target: 5432\n        published: 5440\n        host_ip: 0.0.0.0\n' > "$BASE/c12/docker-compose.yml"
run_case "long-syntax host_ip: 0.0.0.0" RED "$BASE/c12"

# ── compose: ca HỢP LỆ ⇒ PHẢI XANH (bắt báo oan) ───────────────────────────────────────────────
mk g1; printf 'services:\n  a:\n    ports:\n      - "${INFRA_BIND_ADDR:-127.0.0.1}:5432:5432"\n' > "$BASE/g1/docker-compose.yml"
run_case "OK: \${INFRA_BIND_ADDR:-127.0.0.1}" GREEN "$BASE/g1"

mk g2; printf 'services:\n  a:\n    ports:\n      - "127.0.0.1:9000:9000"\n      - "[::1]:9001:9001"\n' > "$BASE/g2/docker-compose.yml"
run_case "OK: loopback v4 + v6" GREEN "$BASE/g2"

mk g3; printf 'services:\n  a:\n    ports:\n      - target: 6432\n        published: 6432\n        host_ip: 127.0.0.1\n' > "$BASE/g3/docker-compose.yml"
run_case "OK: long-syntax host_ip loopback" GREEN "$BASE/g3"

mk g4; printf 'apiVersion: v1\nkind: Service\nspec:\n  ports:\n    - port: 5432\n' > "$BASE/g4/k8s.yaml"
run_case "OK: YAML không phải compose (k8s)" GREEN "$BASE/g4"

# ── env mẫu: ca LỌT của vòng 2 ⇒ PHẢI ĐỎ ───────────────────────────────────────────────────────
mk e1; printf 'DATABASE_URL="postgres://u:s3cr3tRealPw@h/db"\n' > "$BASE/e1/.env.example"
run_case "URL trong NHÁY KÉP" RED "$BASE/e1"

mk e2; printf "DATABASE_URL='postgres://u:s3cr3tRealPw@h/db'\n" > "$BASE/e2/.env.example"
run_case "URL trong nháy đơn" RED "$BASE/e2"

mk e3; printf 'export DATABASE_URL=postgres://u:s3cr3tRealPw@h/db\n' > "$BASE/e3/.env.example"
run_case "tiền tố export" RED "$BASE/e3"

mk e4; printf 'DB-URL=postgres://u:s3cr3tRealPw@h/db\n' > "$BASE/e4/.env.example"
run_case "khoá có dấu gạch ngang" RED "$BASE/e4"

mk e5; printf 'DATABASE_URL=postgres://u:s3cr3tRealPw@h/db\n' > "$BASE/e5/.env.sample"
run_case "file .env.sample" RED "$BASE/e5"

mk e6; printf 'DATABASE_URL=postgres://u:s3cr3tRealPw@h/db\n' > "$BASE/e6/.env.template"
run_case "file .env.template" RED "$BASE/e6"

mk e7; printf 'DATABASE_URL=postgres://u:s3cr3tRealPw@h/db\n' > "$BASE/e7/env.example"
run_case "file env.example (không dấu chấm)" RED "$BASE/e7"

mk e8; printf 'SMTP_PASSWORD=RealSmtpPw123\nVALKEY_PASSWORD=RealValkeyPw\nADMIN_PASSWORD=RealAdminPw\nLMS_NOTI_TOKEN=RealToken123\n' > "$BASE/e8/.env.example"
run_case "khoá ngoài danh sách liệt kê cũ" RED "$BASE/e8"

# ── env mẫu: ca HỢP LỆ ⇒ PHẢI XANH ─────────────────────────────────────────────────────────────
mk h1; printf 'DATABASE_URL=postgres://u:__SET_ME__@h/db\nAPP_DB_PASSWORD=__SET_ME__\nS3_ACCESS_KEY=mediaos\nPGBOUNCER_URL=${DATABASE_URL}\n# ADMIN_PASSWORD=__SET_ME__\n' > "$BASE/h1/.env.example"
run_case "OK: placeholder + access-key-id + biến" GREEN "$BASE/h1"

# ── file MỚI chưa tracked (bài học 1) ──────────────────────────────────────────────────────────
mk n1; printf 'services:\n  a:\n    ports:\n      - "5432:5432"\n' > "$BASE/n1/docker-compose.yml"
( cd "$BASE/n1" && git init -q . )   # KHÔNG git add
out="$(cd "$BASE/n1" && node "$GUARD" 2>&1)"; rc=$?
if [ $rc -ne 0 ]; then printf '  ✅ %-52s %s\n' "file MỚI CHƯA git add vẫn bị quét" "RED"; pass=$((pass+1));
else printf '  ❌ %-52s LỌT (mù với file mới)\n' "file MỚI CHƯA git add vẫn bị quét"; fail=$((fail+1)); fi

echo ""
echo "  ═══ PASS=$pass  FAIL=$fail ═══"
[ $fail -eq 0 ]
