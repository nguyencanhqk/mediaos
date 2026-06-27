<!-- KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
```yaml
wo: S0-CI-2
zone: yellow
generated_by: agent
reconciled_at: "workflows on-disk: ci.yml,api.yml,apps-frontend.yml,auto-merge.yml + security.yml (MỚI); gitleaks verify chạy thật qua docker zricethezav/gitleaks:latest; pnpm audit chạy thật (5 high)"
lanes:
  - id: S0-CI-2-secscan
    builder: devops-ci
    task: >
      Thêm 2 cổng bảo mật CI (S0-CI-1 đã defer sang đây):
      (1) secret-scan = gitleaks full-history (fetch-depth 0) trên pull_request + push → FAIL khi phát hiện secret thật (BẤT BIẾN #3);
      (2) dependency-scan = pnpm audit --audit-level=high (SCA) → FAIL khi có lỗ hổng high|critical chưa xử lý;
      (3) .gitleaks.toml = extend default ruleset + allowlist HẸP cho ephemeral CI (ci_app_pw/ci_worker_pw/ci_pgb_pw/POSTGRES_PASSWORD: postgres/ci-only-jwt-secret-*) + 2 false-positive class (Idempotency-Key trong docs/QA, tham chiếu env.X trong source);
      (4) cả 2 job là required status check trước merge (đồng bộ branch protection master + auto-merge.yml);
      (5) additive — KHÔNG rewrite ci.yml/api.yml/apps-frontend.yml/auto-merge.yml.
    paths:
      - ".github/workflows/security.yml"
      - ".gitleaks.toml"
acceptanceChecks:
  - "security.yml trigger gồm CẢ pull_request + push branches [master, main]; concurrency group riêng 'security-${{ github.ref }}' (không xung đột ci/api/apps-frontend/auto-merge)"
  - "job secret-scan: actions/checkout@v4 với fetch-depth: 0 (full history); gitleaks/gitleaks-action@v2 → exit non-zero khi tìm secret ⇒ FAIL"
  - "job dependency-scan: pnpm/action-setup@v4 (11.5.1) + setup-node@v4 (node 22, cache pnpm) + pnpm install --frozen-lockfile + pnpm audit --audit-level=high (ngưỡng fail = high|critical ghi rõ comment)"
  - ".gitleaks.toml: [extend] useDefault=true; allowlist phạm vi HẸP (đường dẫn ci.yml + chuỗi ephemeral tường minh + 2 false-positive class anchored) — KHÔNG có pattern bao trùm (.* / allowlist toàn .github/ / allowlist *.ts)"
  - "gitleaks git-mode scan repo sạch (full history 486 commit) ⇒ 0 leaks (exit 0) — KHÔNG false-positive; .env.prod (gitignored) KHÔNG bị scan ⇒ secret thật giữ ngoài git"
  - "RED: inject secret giả (GitHub PAT/Slack token/hardcoded literal) ⇒ gitleaks bắt + exit 1 (FAIL build); allowlist KHÔNG che literal hard-code (chỉ excuse env.X)"
  - "pnpm audit --audit-level=high: exit non-zero khi có high/critical (gate hoạt động) — repo hiện có 5 high ⇒ defer-có-vé bump deps (KHÔNG hạ ngưỡng xuống critical để giấu)"
  - "4 workflow hiện có vẫn parse YAML hợp lệ sau khi thêm security.yml (regression — không phá pipeline)"
testTasks:
  - "QA06-CICD-001 (RED→GREEN): gitleaks GREEN repo sạch → 0 leaks exit 0; RED inject fake secret → leaks>0 exit 1"
  - "QA06-CICD-001 boundary: hardcoded secret literal (apiKey/slackToken) VẪN bị bắt — allowlist hẹp không che secret thật"
  - "QA06-CICD-002: pnpm audit --audit-level=high → FAIL khi high/critical (verify exit 1 trên repo có 5 high); ngưỡng khớp workflow"
  - "QA-06 §10 (dòng 227): pnpm-lock.yaml được commit + được scan (install --frozen-lockfile trước audit)"
  - "workflow integrity: js-yaml parse security.yml + 4 workflow cũ → tất cả VALID; trigger matrix (pull_request + push master/main) đúng; concurrency group riêng"
steps:
  - "1. .github/workflows/security.yml (MỚI, additive): on pull_request + push [master,main]; concurrency security-${{ github.ref }}; permissions contents:read"
  - "2. job secret-scan: checkout@v4 fetch-depth:0 → gitleaks-action@v2 với GITLEAKS_CONFIG trỏ .gitleaks.toml"
  - "3. job dependency-scan: pnpm-setup 11.5.1 + node 22 cache pnpm + install --frozen-lockfile + pnpm audit --audit-level=high (comment ngưỡng = high|critical)"
  - "4. .gitleaks.toml (MỚI): [extend] useDefault=true; [[allowlists]] #0 ci.yml ephemeral (path-scoped + chuỗi tường minh); #1 Idempotency-Key docs/QA; #2 env.X reference source"
  - "5. Verify thật qua docker: gitleaks git-mode (0 leaks) + --no-git RED fixture (caught) + boundary (literal caught); pnpm audit (5 high → exit 1, gate đúng)"
  - "6. Đăng ký secret-scan + dependency-scan là required status check trên branch protection master (việc repo-admin — xem §4)"
  - "7. backlog.mjs: status + plan trỏ docs/plans/S0-CI-2.md; defer bump-deps (5 high) + SAST/CodeQL + Trivy image sang WO sau"
```

# S0-CI-2 — Micro-plan (CI security gates: secret-scan + dependency-scan)

> Zone: vàng (yellow). Hai cổng bảo mật mà S0-CI-1 defer-có-vé sang đây (DEVOPS-02 §9.2/§11/§17.2).
> ADDITIVE thuần: file MỚI `.github/workflows/security.yml` + `.gitleaks.toml`. KHÔNG rewrite ci.yml/api.yml/apps-frontend.yml/auto-merge.yml.
> Verify chạy THẬT bằng `zricethezav/gitleaks:latest` qua docker + `pnpm audit` cục bộ.

## 0. Kết quả đối chiếu (đã verify line-level + chạy tool thật)

| done_when | Trạng thái | Bằng chứng |
| --- | --- | --- |
| #1 secret-scan trên PR + push; inject secret giả → FAIL; repo sạch → PASS không false-positive | ✅ **đạt** | gitleaks git-mode repo sạch (486 commit) = `no leaks found` exit 0; RED fixture (GitHub PAT) → exit 1; boundary literal (apiKey/slackToken) vẫn bắt |
| #2 dependency-scan pnpm audit --audit-level=high là cổng PR; ngưỡng fail ghi rõ; lockfile scan | ✅ **đạt** (cổng đúng) | `pnpm audit --audit-level=high` exit 1 trên repo hiện tại (5 high) ⇒ chứng minh gate FAIL đúng; install --frozen-lockfile trước audit ⇒ scan pnpm-lock.yaml |
| #3 ADDITIVE — không rewrite 4 workflow cũ; actionlint/yaml hợp lệ | ✅ **đạt** | js-yaml parse 5 workflow → tất cả VALID; ci.yml/api.yml/apps-frontend.yml/auto-merge.yml KHÔNG đụng tới |
| #4 BẤT BIẾN #3 — không hard-code secret thật; allowlist HẸP | ✅ **đạt** | allowlist chỉ: chuỗi ephemeral CI (path-scoped ci.yml) + Idempotency-Key (non-secret by design) + env.X reference (đọc env, đúng pattern); boundary test chứng minh literal hard-code VẪN bị bắt |
| #5 2 cổng là required status check; đo độc lập | ⚠️ **một phần** — workflow + tên job sẵn sàng; bật required là việc repo-admin | Tên job: `Secret scan (gitleaks)` + `Dependency scan (pnpm audit)`; §4 ghi quy trình bật |
| #6 DoD: backlog cập nhật + defer ghi vé | ✅ **đạt** | backlog.mjs status + plan trỏ; defer bump-deps/SAST/Trivy ghi §7 |

## 1. Deviation branch model — ghi chính thức (đồng bộ S0-CI-1)

DEVOPS-02 §6.1/§9.1/§10 khuyến nghị mô hình `develop → main`. Repo dùng `master` làm nhánh chính DUY NHẤT (không `develop`).

**Quyết định (kế thừa S0-CI-1):** Giữ `master` làm nhánh tích hợp duy nhất. Lý do: N=1 single-tenant, team nhỏ, solo-owner — tách `develop` tạo overhead merge không có giá trị bảo vệ thực. Branch protection master + PR bắt buộc + CI gate đủ. Nếu mở rộng multi-tenant SaaS → xem xét lại + ADR riêng.

**Tác động security.yml:** trigger `push.branches: [master, main]` + `pull_request` (mọi nhánh nguồn) — đồng bộ ci.yml/api.yml/apps-frontend.yml. Không mở `develop`.

## 2. Thiết kế hai cổng

### A. `secret-scan` — gitleaks full-history (BẤT BIẾN #3)

- `actions/checkout@v4` với `fetch-depth: 0` → gitleaks quét MỌI commit (bắt secret bị commit rồi "xóa" — vẫn nằm trong history ⇒ vẫn rò).
- `gitleaks/gitleaks-action@v2`, `GITLEAKS_CONFIG` trỏ `.gitleaks.toml`. Phát hiện secret ⇒ exit non-zero ⇒ FAIL build.
- KHÔNG bật upload-artifact mặc định để tránh log/artifact lộ chuỗi nghi vấn.

### B. `dependency-scan` — pnpm audit (SCA)

- `pnpm/action-setup@v4` (11.5.1) + `setup-node@v4` (node 22, cache pnpm) + `pnpm install --frozen-lockfile` (cài đúng lockfile đã commit ⇒ audit quét chính `pnpm-lock.yaml`, QA-06 §10 dòng 227).
- `pnpm audit --audit-level=high` → **ngưỡng fail = high|critical** (ghi rõ comment trong workflow). Low/moderate báo cáo nhưng KHÔNG chặn merge (khớp QA06-CICD-002 "Không Critical/High chưa xử lý").

### C. `.gitleaks.toml` — allowlist HẸP (không che secret thật)

- `[extend] useDefault = true` — kế thừa toàn bộ ruleset gitleaks (AWS/GCP/JWT/PAT/private key/generic).
- `[[allowlists]]` #0: ephemeral CI — `paths` neo đúng `\.github/workflows/ci\.yml`, `regexes` liệt kê tường minh `ci_app_pw`/`ci_worker_pw`/`ci_pgb_pw`/`POSTGRES_PASSWORD: postgres`/`mediaos:postgres@`/`ci-only-jwt-secret-[0-9a-f]+`.
- `[[allowlists]]` #1: `Idempotency-Key`/`idempotency_key` trong docs/QA — token client-sinh khử trùng request, **non-secret by design**. Anchor theo header context, KHÔNG allowlist UUID chung.
- `[[allowlists]]` #2: tham chiếu `(secret|token|key|password)... = env.X` trong source — biểu thức ĐỌC env (đúng pattern BẤT BIẾN #3), KHÔNG phải hard-code. Anchor theo `= env.<NAME>`, KHÔNG allowlist giá trị literal.

## 3. Bất biến giữ nguyên (KHÔNG hồi quy)

- **BẤT BIẾN #3 — no secret plaintext:** không thêm secret thật nào vào workflow/.gitleaks.toml. Allowlist CHỈ chứa chuỗi ephemeral CI + class false-positive non-secret. **Bằng chứng allowlist hẹp:** boundary test (hardcoded `apiKey = "..."` + Slack token) VẪN bị bắt. `.env.prod` chứa secret thật nhưng gitignored + untracked ⇒ KHÔNG vào git ⇒ gitleaks-action (git-mode) không scan nó.
- **Additive:** không đụng ci.yml (giữ gate RLS-qua-PgBouncer), api.yml, apps-frontend.yml, auto-merge.yml. security.yml concurrency group riêng.
- **CẤM xanh-giả:** không hạ `--audit-level` xuống `critical` để giấu 5 high; không nới allowlist gitleaks bằng pattern bao trùm. Gate phải thật.

## 4. Required status check (branch protection master)

Hai job phải là **required status check** trên branch protection của `master` để auto-merge.yml chỉ squash sau khi cả hai xanh:

- `Secret scan (gitleaks)`
- `Dependency scan (pnpm audit)`

Lệnh repo-admin (chạy 1 lần, ngoài phạm vi commit code — cần quyền admin repo):

```bash
gh api -X PUT repos/{owner}/{repo}/branches/master/protection/required_status_checks \
  -f strict=true \
  -f 'contexts[]=Secret scan (gitleaks)' \
  -f 'contexts[]=Dependency scan (pnpm audit)'
# (gộp cùng các check hiện có: 'verify' của ci.yml — KHÔNG ghi đè, THÊM vào contexts)
```

> Lưu ý: thao tác này sửa cấu hình repo (không phải file trong repo) ⇒ KHÔNG nằm trong commit của lane. Ghi ở đây làm nguồn sự thật để repo-admin thực hiện. Mỗi cổng pass/fail đo độc lập theo tên job.

## 5. Verify (đã chạy thật)

```bash
# Secret-scan GREEN (repo sạch, full history) — CI-equivalent git mode:
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:latest \
  detect --config /repo/.gitleaks.toml
# → "486 commits scanned" + "no leaks found" + exit 0   ✅

# Secret-scan RED (inject fake GitHub PAT / Slack token):
#   gitleaks detect --no-git → "leaks found" + exit 1   ✅ (build FAIL)
# Boundary: hardcoded apiKey/slackToken literal vẫn bị bắt (allowlist không che) ✅

# Dependency-scan:
pnpm audit --audit-level=high
# → exit 1 (repo hiện có 5 high: drizzle-orm, ws, form-data, multer, nodemailer) ✅ gate FAIL đúng

# Workflow integrity (js-yaml parse):
# → security.yml + ci.yml + api.yml + apps-frontend.yml + auto-merge.yml = tất cả VALID ✅
```

## 6. Gate

FULL gate (diff chạm `secret` + CI security): `security-reviewer` + `silent-failure-hunter` (đảm bảo không xanh-giả / không nuốt finding) + `quality-gate`. Zone vàng — người chốt trước merge (allowlist gitleaks là điểm nhạy cảm: phải xác nhận hẹp).

## 7. Defer-CÓ-VÉ (KHÔNG thu hẹp âm thầm pipeline DEVOPS-02 §9.2)

- **WO mới — bump deps high (5 advisories):** drizzle-orm ≥0.45.2, ws ≥8.21.0, form-data ≥4.0.6, multer ≥2.2.0, nodemailer ≥9.0.1. Cần làm SỚM vì dependency-scan sẽ ĐỎ tới khi bump xong. Đây là finding thật, KHÔNG giấu bằng cách hạ ngưỡng. (Đề xuất id: `S0-DEP-BUMP-1`.)
- **SAST/CodeQL (QA06-CICD-003, DEVOPS-02 §9.2):** Semgrep/CodeQL chưa làm ở WO này → WO sau (`S0-CI-3` hoặc CodeQL default setup).
- **Trivy image scan (QA06-CICD-004):** chưa có docker image build pipeline → khi có image (DEVOPS-06) bổ sung Trivy.
- **Docker build smoke (DEVOPS-02 §9.3):** thuộc image pipeline, defer cùng Trivy.
