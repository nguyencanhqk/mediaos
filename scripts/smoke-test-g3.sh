#!/usr/bin/env bash
# smoke-test-g3.sh — G3 guard pipeline smoke test
#
# Chạy sau khi deploy G3-4 (guards + cache).
# 10 route: đúng quyền → 200/201, sai quyền/thiếu token → 401/403.
#
# Dùng:
#   BASE_URL=http://localhost:3100/api/v1 \
#   COMPANY_SLUG=acme \
#   TEST_EMAIL=admin@acme.test \
#   TEST_PASSWORD=password \
#   bash scripts/smoke-test-g3.sh
#
# Exit 0 = tất cả pass. Exit 1 = có route fail (tên route được log ra).

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3100/api/v1}"
COMPANY_SLUG="${COMPANY_SLUG:-acme}"
TEST_EMAIL="${TEST_EMAIL:-admin@acme.test}"
TEST_PASSWORD="${TEST_PASSWORD:-password}"

PASS=0
FAIL=0
FAILED_ROUTES=()

# ─── Helpers ────────────────────────────────────────────────────────────────

check() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $label (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label — expected HTTP $expected, got HTTP $actual"
    FAIL=$((FAIL + 1))
    FAILED_ROUTES+=("$label")
  fi
}

http() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

# ─── 1. Acquire token ───────────────────────────────────────────────────────

echo "=== Acquiring tokens ==="

LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"companySlug\":\"$COMPANY_SLUG\",\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Login failed — cannot acquire token. Check credentials and server."
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi
echo "  ✓ Token acquired"

# ─── 2. Route checks ────────────────────────────────────────────────────────

echo ""
echo "=== Route smoke tests ==="

# R1 — Public: health endpoint
check "R1 GET /health (public → 200)" "200" \
  "$(http "$BASE_URL/health")"

# R2 — Public: DB health
check "R2 GET /health/db (public → 200)" "200" \
  "$(http "$BASE_URL/health/db")"

# R3 — Auth: login with valid credentials
STATUS=$(http -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"companySlug\":\"$COMPANY_SLUG\",\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")
check "R3 POST /auth/login valid creds (→ 200)" "200" "$STATUS"

# R4 — Auth: login with invalid password → 401
STATUS=$(http -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"companySlug\":\"$COMPANY_SLUG\",\"email\":\"$TEST_EMAIL\",\"password\":\"wrong\"}")
check "R4 POST /auth/login bad password (→ 401)" "401" "$STATUS"

# R5 — JWT guard: /auth/me with no token → 401
check "R5 GET /auth/me no token (→ 401)" "401" \
  "$(http "$BASE_URL/auth/me")"

# R6 — JWT guard: /auth/me with valid token → 200
check "R6 GET /auth/me valid token (→ 200)" "200" \
  "$(http "$BASE_URL/auth/me" -H "Authorization: Bearer $TOKEN")"

# R7 — CompanyGuard: request with token but wrong company_id header → 403
# NOTE: filled in during G3-4 when CompanyGuard is wired.
# Placeholder: call a guarded endpoint with a spoofed company header.
# check "R7 CompanyGuard wrong company (→ 403)" "403" \
#   "$(http "$BASE_URL/..." -H "Authorization: Bearer $TOKEN" -H "X-Company-Id: 00000000-0000-0000-0000-000000000000")"
echo "  ~ R7 CompanyGuard mismatch — TODO: fill in G3-4 guarded route"

# R8 — PermissionGuard: protected route with no permission → 403
# NOTE: filled in during G3-4 when @RequirePermission decorators are added.
# check "R8 PermissionGuard no permission (→ 403)" "403" \
#   "$(http "$BASE_URL/..." -H "Authorization: Bearer $TOKEN")"
echo "  ~ R8 PermissionGuard missing permission — TODO: fill in G3-4 guarded route"

# R9 — PermissionGuard: protected route with correct permission → 200
# NOTE: filled in during G3-4.
# check "R9 PermissionGuard correct permission (→ 200)" "200" \
#   "$(http "$BASE_URL/..." -H "Authorization: Bearer $TOKEN")"
echo "  ~ R9 PermissionGuard allowed — TODO: fill in G3-4 guarded route"

# R10 — Sensitive action without explicit grant → 403
# NOTE: filled in during G3-4 (e.g. reveal-secret without explicit ALLOW).
# check "R10 sensitive no explicit grant (→ 403)" "403" \
#   "$(http -X POST "$BASE_URL/..." -H "Authorization: Bearer $TOKEN")"
echo "  ~ R10 sensitive no-grant deny — TODO: fill in G3-4 guarded route"

# ─── 3. Summary ─────────────────────────────────────────────────────────────

echo ""
echo "=== Summary ==="
echo "  PASS: $PASS  FAIL: $FAIL  TODO (G3-4): 4"

if [ ${#FAILED_ROUTES[@]} -gt 0 ]; then
  echo "  Failed routes:"
  for r in "${FAILED_ROUTES[@]}"; do
    echo "    - $r"
  done
  exit 1
fi

echo "  All active checks passed."
