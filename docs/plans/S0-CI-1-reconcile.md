<!-- KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
<!-- REV 2026-06-23 (plan-review BLOCK fix): apps/app ĐÃ TỒN TẠI (scaffold giữ lại) → bật filter 'app'; db:check kiểm BẤT BIẾN journal động (KHÔNG hard-code idx). -->
```yaml
wo: S0-CI-1
zone: green
generated_by: human
reconciled_at: "migration head idx 121 / 0438 (đọc động từ _journal.json — KHÔNG chốt số); apps-on-disk: api,auth,console,app (apps/app ĐÃ tồn tại, package.json @mediaos/app hợp lệ + scripts build/typecheck/test); workflows: ci.yml,api.yml,apps-frontend.yml,auto-merge.yml,security.yml"
lanes:
  - id: S0-CI-1-devops
    builder: devops-ci
    task: >
      Chỉnh pipeline pnpm+turbo cho PR:
      (1) thêm script db:check vào apps/api/package.json (migrate DB rỗng + kiểm BẤT BIẾN journal NỘI TẠI: idx forward-only liên tục từ 0, KHÔNG gap, tag KHÔNG trùng; head = entries[last].idx đọc TỪ migrations/meta/_journal.json — KHÔNG so hằng số chép tay);
      (2) thêm bước migration-check vào ci.yml và api.yml dùng db:check;
      (3) path-filter apps-frontend.yml gồm auth+console+app (apps/app ĐÃ tồn tại với package.json hợp lệ + script typecheck/test/build): thêm entry `app: [ 'apps/app/**', 'packages/**', 'pnpm-lock.yaml' ]`;
      (4) xoá comment thừa "admin = operator plane" dòng ~105 apps-frontend.yml;
      (5) ghi deviation branch model master vs DEVOPS-02 develop/main;
      (6) defer secret-scan + dependency-scan → S0-CI-2 bằng comment rõ ràng (security.yml đã có ở S0-CI-2 — chỉ trỏ, KHÔNG trùng lặp).
    paths:
      - ".github/workflows/ci.yml"
      - ".github/workflows/api.yml"
      - ".github/workflows/apps-frontend.yml"
      - "apps/api/package.json"
      - "apps/api/src/db/check.ts"
      - "turbo.json"
      - "package.json"
      - "pnpm-workspace.yaml"
acceptanceChecks:
  - "db:check tồn tại trong apps/api/package.json scripts; CI job chạy sau db:migrate; exit 0 khi migrate sạch + journal hợp lệ (forward-only, no-gap, no-dup-tag, head khớp số migration đã áp); exit 1 khi journal trống/gap/trùng tag hoặc migrate fail — KHÔNG so literal idx chép tay"
  - "path-filter apps-frontend.yml: filters gồm 'auth', 'console', VÀ 'app' (apps/app đã có package.json) — KHÔNG có 'web', KHÔNG có 'admin'"
  - "thay đổi trong apps/app/** trigger matrix build app (app có CI coverage — KHÔNG còn lỗ hổng CI im lặng); matrix mở rộng đúng qua fromJSON"
  - "comment 'admin = operator plane' dòng ~105 apps-frontend.yml đã bị xoá"
  - "ci.yml và api.yml đều có bước 'migration-check (db:check)' chạy SAU 'Apply migrations'"
  - "ci.yml có comment rõ '# DEFER → S0-CI-2: secret-scan + dependency-scan' (security.yml đã hiện thực ở S0-CI-2) với lý do"
  - "branch model master được ghi rõ trong prose kế hoạch này — KHÔNG mở nhánh develop"
testTasks:
  - "chạy db:check cục bộ trên DB isolate lane: exit 0 + in head idx ĐỘNG (đọc từ journal) + 'journal OK (forward-only, no-gap)'"
  - "db:check NEGATIVE: tạo journal có gap/trùng tag (fixture) → exit 1 + thông báo rõ; migrate fail → exit 1"
  - "chạy pnpm lint trên workspace: exit 0"
  - "chạy pnpm typecheck trên workspace: exit 0 (contracts build trước qua turbo)"
  - "chạy pnpm --filter @mediaos/api test: exit 0"
  - "chạy pnpm build: exit 0 (contracts → api → auth → console → app)"
  - "kiểm tra path-filter apps-frontend.yml: dorny/paths-filter dry-run → đổi apps/app/** ⇒ 'app' xuất hiện trong changes"
steps:
  - "1. Viết apps/api/src/db/check.ts: migrate lên DB rỗng (DATABASE_DIRECT_URL) → đọc migrations/meta/_journal.json → kiểm BẤT BIẾN: entries idx tăng liên tục từ 0 (no gap), tag duy nhất (no dup), head=entries[last].idx; đối chiếu số migration đã áp = số entries. In 'head idx: <n> — OK' (n ĐỌC ĐỘNG). exit 0 hợp lệ / exit 1 khi gap/dup/trống/migrate fail. KHÔNG hằng số EXPECTED_HEAD_IDX."
  - "2. Thêm script 'db:check': 'tsx src/db/check.ts' vào apps/api/package.json — song song db:migrate không xung đột"
  - "3. Thêm bước 'Migration check (db:check)' vào ci.yml SAU bước 'Apply migrations': pnpm --filter @mediaos/api db:check"
  - "4. Thêm bước 'Migration check (db:check)' vào api.yml SAU bước 'Apply migrations': pnpm --filter @mediaos/api db:check"
  - "5. apps-frontend.yml: xoá comment dòng ~105 'admin = operator plane, deploy riêng nếu cần'"
  - "6. apps-frontend.yml: thêm entry filter `app: [ 'apps/app/**', 'packages/**', 'pnpm-lock.yaml' ]` (giống auth/console); xác minh apps/app có script typecheck+test+build TRƯỚC khi bật (đã có)"
  - "7. ci.yml: thêm comment block DEFER ngay sau bước Test: '# DEFER → S0-CI-2: secret-scan (gitleaks) + dependency-scan (pnpm audit) — ĐÃ hiện thực ở security.yml (WO S0-CI-2); KHÔNG bỏ qua silently (DEVOPS-02 §9.2/§11/§17.2)'"
  - "8. api.yml: thêm cùng comment DEFER tương tự"
  - "9. Verify toàn bộ bằng lệnh ở mục 4"
```

# S0-CI-1 — Micro-plan (căn chỉnh pipeline CI/CD + path-filter + migration-check)

> Zone: xanh (green). Thay đổi additive với ci.yml/api.yml/apps-frontend.yml và apps/api/package.json.
> Migration head: idx 121 / `0438` — db:check ĐỌC ĐỘNG từ journal, KHÔNG hard-code. Apps trên disk: api, auth, console, **app** (apps/app ĐÃ tồn tại).

## 0. Kết quả đối chiếu (đã verify line-level — REV 2026-06-23)

| done_when | Trạng thái | Hành động |
| --- | --- | --- |
| #1 PR pipeline: lint → typecheck → test → build → migration-check | ⚠️ **gap: db:check chưa có** | Thêm `db:check` script (journal-invariant, KHÔNG hard-code idx) vào api/package.json + bước CI vào ci.yml và api.yml |
| #2 path-filter: api.yml → apps/api; apps-frontend.yml → auth+console(+**app**); không trỏ web/admin | ⚠️ **filter THIẾU 'app'** (apps/app đã tồn tại nhưng chưa được CI bao phủ → lỗ hổng im lặng); comment thừa "admin = operator plane" dòng ~105 còn đó | Thêm entry `app`; xoá comment thừa |
| #3 branch model = master; ghi lệch vs DEVOPS-02 | ⚠️ **chưa ghi chính thức** | Ghi deviation trong kế hoạch này (prose) + comment trong workflow |
| #4 secret-scan + dependency-scan DEFER → S0-CI-2 | ✅ **ĐÃ hiện thực ở security.yml (S0-CI-2)**; ⚠️ ci.yml/api.yml chưa có comment trỏ rõ | Thêm comment trỏ S0-CI-2/security.yml vào ci.yml và api.yml |

**Không có gì phải làm ở:** turbo.json (build/typecheck/test/lint đã đúng thứ tự), pnpm-workspace.yaml (apps/* packages/* đủ — apps/app tự nhận), pnpm trigger (master + main đã có trong cả 3 workflow).

**apps trên disk (đã xác minh 2026-06-23):** `apps/api`, `apps/auth`, `apps/console`, **`apps/app`** — apps/app ĐÃ được scaffold (package.json `@mediaos/app` + src + test + scripts `build`/`typecheck`/`test`). ⇒ Path-filter apps-frontend.yml PHẢI gồm `app`; nếu không, mọi thay đổi apps/app sẽ KHÔNG trigger CI ⇒ app vỡ build mà pipeline vẫn xanh (lỗ hổng CI im lặng — đây là lý do plan-review BLOCK bản cũ).

**Stale comment tìm thấy:** dòng ~105 của `apps-frontend.yml` — `admin = operator plane, deploy riêng nếu cần` — tham chiếu app `admin` (operator plane) đã park. Cần xoá.

---

## 1. Deviation branch model — ghi chính thức

DEVOPS-02 §6.1/§9.1/§10 khuyến nghị mô hình `develop → main`. Repo hiện dùng `master` làm nhánh chính duy nhất (không có `develop`).

**Quyết định:** Giữ `master` làm nhánh tích hợp duy nhất.

**Lý do:** Dự án đang ở giai đoạn N=1 single-tenant, team nhỏ, vận hành solo-owner. Tách `develop` tạo overhead merge mà không mang lại giá trị bảo vệ thực tế ở quy mô này. Branch protection trên master + PR bắt buộc + CI gate thay thế đủ. Nếu team mở rộng hoặc chuyển sang multi-tenant SaaS, quyết định này được xem xét lại và ghi ADR riêng.

**Tác động lên workflow:** Tất cả ci trigger đã có `branches: [master, main]` — không cần sửa. Không mở nhánh `develop`. Ghi chú này là nguồn sự thật cho deviation.

---

## 2. Phạm vi thay đổi (CHỈ additive — KHÔNG xoá gate nào)

### A. `apps/api/src/db/check.ts` (file mới) — gate BẤT BIẾN journal (KHÔNG hard-code idx)

Script kiểm tra drift migration **bền theo thời gian** (không phải khớp một literal sẽ mục): migrate lên DB rỗng qua `DATABASE_DIRECT_URL`, rồi đọc `migrations/meta/_journal.json` và kiểm các BẤT BIẾN NỘI TẠI:

- `entries` có `idx` tăng **liên tục từ 0**, KHÔNG gap, KHÔNG trùng;
- mỗi `tag` duy nhất (không hai migration cùng tag);
- `head = entries[entries.length - 1].idx` — đọc ĐỘNG, KHÔNG so hằng số;
- số migration đã áp trên DB rỗng = `entries.length` (migrate-clean thành công).

In rõ ràng (head ĐỌC ĐỘNG):

```
[db:check] head idx: 121 (0438_foundation_db6_audit_db08_shape) — journal OK (forward-only, no-gap, no-dup)
```

hoặc:

```
[db:check] FAIL: journal gap tại idx 119 (118 → 120)
[db:check] FAIL: migrate clean thất bại: <lỗi>
```

Exit 0 khi mọi bất biến đạt + migrate sạch; exit 1 khi gap/dup/trống/migrate fail.

> **VÌ SAO KHÔNG hard-code `EXPECTED_HEAD_IDX`:** một hằng số sống trong file của S0-CI-1 nhưng số thực tăng mỗi khi WO migration KHÁC (S0-FND-DB-1, S0-FND-SEED-1, S0-AUTH-DB-1…) land ⇒ mọi PR đang mở khác sẽ ĐỎ tới khi ai đó bump tay; coupling "bump trong DoD mỗi WO migration" KHÔNG được ép ở đâu cả ⇒ gate hỏng theo thời gian. Kiểm BẤT BIẾN nội tại của journal vẫn bắt được drift thật (gap/dup/migrate-fail) mà KHÔNG cần đồng bộ số tay.

### B. `apps/api/package.json` — thêm script

```json
"db:check": "tsx src/db/check.ts"
```

Không đụng script nào hiện có. Thêm additive vào block `scripts`.

### C. `.github/workflows/ci.yml` — thêm bước migration-check

Sau bước `Apply migrations (real Postgres)`, chèn:

```yaml
- name: Migration check (db:check)
  run: pnpm --filter @mediaos/api db:check
```

Chạy cùng Postgres ephemeral, cùng `DATABASE_DIRECT_URL`. Pass/fail đo bằng exit code — CI tự đỏ nếu check thất bại.

Sau bước `Test`, thêm comment DEFER (trỏ S0-CI-2 đã hiện thực):

```yaml
# DEFER → S0-CI-2: secret-scan (gitleaks) + dependency-scan (pnpm audit)
# ĐÃ hiện thực ở .github/workflows/security.yml (WO S0-CI-2). KHÔNG bỏ qua silently.
# DEVOPS-02 §9.2/§11/§17.2 liệt kê cả hai là bắt buộc.
```

### D. `.github/workflows/api.yml` — thêm bước migration-check + comment DEFER

Cùng pattern với ci.yml: sau bước `Apply migrations` chèn bước `db:check`; cuối file thêm comment DEFER tương tự.

### E. `.github/workflows/apps-frontend.yml` — bật filter `app` + xoá comment thừa

Trong block `filters` của job `changes`, thêm entry `app` (apps/app ĐÃ tồn tại — phải có CI coverage):

```yaml
filters: |
  auth:    [ 'apps/auth/**',    'packages/**', 'pnpm-lock.yaml' ]
  console: [ 'apps/console/**', 'packages/**', 'pnpm-lock.yaml' ]
  app:     [ 'apps/app/**',     'packages/**', 'pnpm-lock.yaml' ]
```

Matrix `fromJSON(needs.changes.outputs.apps)` tự mở rộng để build `app`. apps/app đã có script `typecheck`/`test`/`build` (đã xác minh) nên matrix sẽ KHÔNG fail "package không tìm thấy".

Dòng ~105 — xoá đoạn `admin = operator plane, deploy riêng nếu cần.` khỏi comment:

```
# rồi gắn custom domain (runbook §2). admin = operator plane, deploy riêng nếu cần.
```

Thành:

```
# rồi gắn custom domain (runbook §2).
```

---

## 3. Bất biến giữ nguyên (KHÔNG hồi qui)

- **BẤT BIẾN #1 — tenant isolation:** `DATABASE_URL` trong CI tiếp tục trỏ tới role `mediaos_app` (NOSUPERUSER, NOBYPASSRLS). Không nới quyền role CI.
- **BẤT BIẾN #2 — migration RLS trước test:** Thứ tự trong ci.yml giữ nguyên — `Apply migrations` (tạo bảng + RLS policy + FORCE) → `db:check` → `Setup DB role passwords` → `Start PgBouncer` → `Test`. Không đảo thứ tự.
- **BẤT BIẾN #3 — no-secret:** Không thêm secret nào vào workflow. Env `DATABASE_DIRECT_URL`, `APP_DB_PASSWORD`, `WORKER_DB_PASSWORD` là ephemeral CI — đã có, không thêm mới. `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` vẫn là placeholder (`secrets.*`).
- **KHÔNG tắt kiểm tra:** Cấm `@ts-ignore`/`eslint-disable`. Cấm bỏ gate hiện có để "xanh giả". `db:check` PHẢI thực sự migrate + kiểm journal — không phải `echo OK`.

---

## 4. Deviation giữ nguyên (KHÔNG churn)

- `turbo.json` — cấu trúc `build` / `typecheck` / `test` / `lint` / `dev` hiện tại đủ dùng; không thêm pipeline task.
- `pnpm-workspace.yaml` — `apps/*` đủ; apps/app tự nhận, không cần sửa.
- `apps-frontend.yml` matrix strategy — `fromJSON(needs.changes.outputs.apps)` đúng; khi filter thêm `app`, matrix tự mở rộng.

---

## 5. Verify (DB cô lập theo lane)

```bash
bash scripts/lane-db-setup.sh ci1
export LANE_DB=mediaos_ci1
export DATABASE_DIRECT_URL=postgres://mediaos:postgres@localhost:5432/mediaos_ci1

# Bước 1: migrate sạch
pnpm --filter @mediaos/api db:migrate

# Bước 2: migration-check — phải in "head idx: <n đọc động> — journal OK" và exit 0
pnpm --filter @mediaos/api db:check

# Bước 3: bộ test đầy đủ
pnpm --filter @mediaos/api test

# Bước 4: build toàn workspace (gồm app)
pnpm build

# Bước 5: lint + typecheck
pnpm lint
pnpm typecheck

# Bước 6: xác nhận path-filter apps-frontend.yml gồm app, KHÔNG có web/admin
grep -nE "^\s+(app|auth|console|web|admin):" .github/workflows/apps-frontend.yml
# Kết quả mong đợi: app + auth + console; KHÔNG có web/admin
```

Đích: `db:check` exit 0 + in head idx ĐỘNG; tất cả test xanh; lint/typecheck xanh; build xanh (gồm app); path-filter gồm auth+console+app.

---

## 6. Gate

LIGHT (thay đổi DEVOPS/workflow/package.json — không chạm permission/RLS/secret/audit/migration): `typescript-reviewer` + `quality-gate`. Không cần người chốt thủ công trước merge (zone xanh, auto-merge đủ nếu CI pass + 1 review).

---

## 7. Out-of-scope (KHÔNG làm ở WO này)

- `db:check` không cần test "happy" riêng (exit code là gate đo được) — NHƯNG có 1 negative fixture test (journal gap/dup → exit 1) trong testTasks để chống gate giả.
- Secret-scan (gitleaks) + dependency-scan (pnpm audit) → ĐÃ hiện thực ở **S0-CI-2** (`security.yml`). S0-CI-1 chỉ trỏ comment DEFER, KHÔNG trùng lặp.
- Docker build smoke → **S0-CI-2** hoặc sau.
- Scaffold `apps/app` → ĐÃ XONG (giữ lại từ wave1; nay BẬT entry `app` trong path-filter ở WO này).
- Thay đổi branch model (nếu cần mở `develop`) → ADR riêng, không thuộc S0-CI-1.
