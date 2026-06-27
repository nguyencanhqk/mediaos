#!/usr/bin/env bash
# Cấu hình GitHub cho harness: auto-merge AN TOÀN + branch protection trên `master`.
# Chạy SAU `gh auth login` (cần quyền admin repo). Đây là hành động MỘT-LẦN, do NGƯỜI chạy —
# nó đổi cấu hình GitHub thật, không phải việc agent tự động.
#
# Dùng:
#   bash scripts/setup-github.sh
#   REPO=owner/name BRANCH=master bash scripts/setup-github.sh
#
# Triết lý (xem harness/policy.md): agent chỉ MỞ PR + gắn nhãn `auto-merge`; GitHub chỉ squash-merge
# khi branch protection thoả (CI xanh + 1 review NGƯỜI). Agent KHÔNG bao giờ push thẳng master.
set -euo pipefail

REPO="${REPO:-nguyencanhqk/mediaos}"
BRANCH="${BRANCH:-master}"

# CONTEXT = TÊN HIỂN THỊ của job CI bắt buộc (không phải job-id).
# ci.yml job `verify` đặt `name: "Lint · Typecheck · Migrate · RLS Test"` ⇒ context chính là chuỗi đó.
# Đây là gate "không rò chéo tenant" (RLS/integration thật), chạy MỌI PR ⇒ đủ làm required check.
CONTEXTS_JSON='["Lint · Typecheck · Migrate · RLS Test"]'
# ⚠️ KHÔNG thêm job của api.yml/apps-frontend.yml (`build-test`/`build`) làm required: chúng bị PATH-FILTER
#    qua job `changes` ⇒ trên PR không chạm path đó job sẽ SKIP, và required-check skip = khoá PR vĩnh viễn.
#    Muốn ép, trước hết phải cho `changes` phát ra status "success" khi filter loại (skippable-required pattern).

echo "==> Repo:   $REPO"
echo "==> Branch: $BRANCH"
echo "==> Required CI context(s): $CONTEXTS_JSON"
echo ""

echo "==> Bật auto-merge + squash + auto-delete-branch trên $REPO"
gh api -X PATCH "repos/$REPO" \
  -F allow_auto_merge=true \
  -F allow_squash_merge=true \
  -F delete_branch_on_merge=true >/dev/null

echo "==> Bảo vệ '$BRANCH': bắt buộc PR + 1 review + CI xanh"
gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - >/dev/null <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": $CONTEXTS_JSON
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON

echo ""
echo "==> Xong. '$BRANCH' giờ: chỉ-PR, 1 review, CI phải xanh, auto-merge đã bật."
echo "    Quy trình: mở PR → gắn nhãn 'auto-merge' (CHỈ vùng 🟢/🟡) → CI xanh + 1 review ⇒ GitHub tự squash-merge."
echo "    Vùng 🔴 (permission/RLS/secret/payroll/finance/audit/migration): KHÔNG gắn nhãn — người merge tay."
