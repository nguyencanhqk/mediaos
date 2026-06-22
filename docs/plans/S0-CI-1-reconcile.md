<!-- KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
```yaml
wo: S0-CI-1
zone: green
generated_by: human
reconciled_at: "migration head idx 121 / 0438; apps-on-disk: api,auth,console (app KHÔNG tồn tại); workflows: ci.yml,api.yml,apps-frontend.yml,auto-merge.yml"
lanes:
  - id: S0-CI-1-devops
    builder: devops-ci
    task: >
      Chỉnh pipeline pnpm+turbo cho PR:
      (1) thêm script db:check vào apps/api/package.json (drizzle migrate empty DB + assert head idx = 121);
      (2) thêm bước migration-check vào ci.yml và api.yml dùng db:check;
      (3) path-filter apps-frontend.yml chỉ gồm auth+console (entry app HIỆN DIỆN nhưng KHÔNG kích hoạt cho tới khi apps/app/package.json tồn tại);
      (4) xoá comment thừa "admin = operator plane" dòng 105 apps-frontend.yml;
      (5) ghi deviation branch model master vs DEVOPS-02 develop/main;
      (6) defer secret-scan + dependency-scan → S0-CI-2 bằng comment rõ ràng trong workflow.
    paths:
      - ".github/workflows/ci.yml"
      - ".github/workflows/api.yml"
      - ".github/workflows/apps-frontend.yml"
      - "apps/api/package.json"
      - "turbo.json"
      - "package.json"
      - "pnpm-workspace.yaml"
acceptanceChecks:
  - "db:check tồn tại trong apps/api/package.json scripts; CI job chạy sau db:migrate; exit 0 khi head idx = 121; exit 1 khi journal trống hoặc idx lệch"
  - "path-filter apps-frontend.yml: filters chỉ liệt kê 'auth' và 'console' — không có 'app', không có 'web', không có 'admin'"
  - "comment '# TODO(S0-CI-2): thêm app khi apps/app/package.json tồn tại' hiện diện trong filter block của apps-frontend.yml"
  - "comment 'admin = operator plane' dòng 105 apps-frontend.yml đã bị xoá"
  - "ci.yml và api.yml đều có bước 'migration-check (db:check)' chạy SAU 'Apply migrations'"
  - "ci.yml có comment rõ '# DEFER → S0-CI-2: secret-scan + dependency-scan' với lý do"
  - "branch model master được ghi rõ trong prose kế hoạch này — KHÔNG mở nhánh develop"
testTasks:
  - "chạy db:check cục bộ trên DB isolate lane: exit 0 + in 'head idx: 121'"
  - "chạy pnpm lint trên workspace: exit 0"
  - "chạy pnpm typecheck trên workspace: exit 0 (contracts build trước qua turbo)"
  - "chạy pnpm --filter @mediaos/api test: exit 0"
  - "chạy pnpm build: exit 0 (contracts → api → auth → console)"
  - "kiểm tra path-filter apps-frontend.yml bằng dorny/paths-filter dry-run: chỉ app trong filter là auth và console"
steps:
  - "1. Viết script apps/api/src/db/check.ts: migrate lên DB rỗng (DATABASE_DIRECT_URL), đọc _journal.json, assert head idx = 121, exit 0 thành công / exit 1 khi lệch hoặc lỗi"
  - "2. Thêm script 'db:check': 'tsx src/db/check.ts' vào apps/api/package.json — song song db:migrate không xung đột"
  - "3. Thêm bước 'Migration check (db:check)' vào ci.yml SAU bước 'Apply migrations': pnpm --filter @mediaos/api db:check"
  - "4. Thêm bước 'Migration check (db:check)' vào api.yml SAU bước 'Apply migrations': pnpm --filter @mediaos/api db:check"
  - "5. apps-frontend.yml: xoá comment dòng 105 'admin = operator plane, deploy riêng nếu cần'"
  - "6. apps-frontend.yml: đảm bảo filters chỉ có auth + console; thêm comment '# TODO(S0-CI-2): kích hoạt entry app khi apps/app/package.json tồn tại'"
  - "7. ci.yml: thêm comment block DEFER ngay sau bước Test: '# DEFER → S0-CI-2: secret-scan (gitleaks/trufflehog) + dependency-scan (Trivy/Dependabot) — xem WO S0-CI-2; defer có chủ đích, KHÔNG bỏ qua silently (DEVOPS-02 §9.2/§11/§17.2)'"
  - "8. api.yml: thêm cùng comment DEFER tương tự"
  - "9. Verify toàn bộ bằng lệnh ở mục 4"
```

# S0-CI-1 — Micro-plan (căn chỉnh pipeline CI/CD + path-filter + migration-check)

> Zone: xanh (green). Thay đổi additive với ci.yml/api.yml/apps-frontend.yml và apps/api/package.json.
> Migration head: idx 121 / `0438`. Apps trên disk: api, auth, console — apps/app KHÔNG tồn tại.

## 0. Kết quả đối chiếu (đã verify line-level)

| done_when | Trạng thái | Hành động |
| --- | --- | --- |
| #1 PR pipeline: lint → typecheck → test → build → migration-check | ⚠️ **gap: db:check chưa có** | Thêm `db:check` script vào api/package.json + bước CI vào ci.yml và api.yml |
| #2 path-filter: api.yml → apps/api; apps-frontend.yml → auth+console; không trỏ app/web/admin | ✅ **đã đúng cho api.yml và auth/console**; ⚠️ comment thừa "admin = operator plane" dòng 105 còn đó; apps/app chưa có nên filter đúng là KHÔNG kích hoạt | Xoá comment thừa; thêm TODO comment về app |
| #3 branch model = master; ghi lệch vs DEVOPS-02 | ⚠️ **chưa ghi chính thức** | Ghi deviation trong kế hoạch này (prose) + comment trong workflow |
| #4 secret-scan + dependency-scan DEFER → S0-CI-2 | ⚠️ **chưa có comment DEFER rõ ràng trong workflow** | Thêm comment DEFER explicit vào ci.yml và api.yml |

**Không có gì phải làm ở:** turbo.json (build/typecheck/test/lint đã đúng thứ tự), pnpm-workspace.yaml (apps/* packages/* đủ), pnpm trigger (master + main đã có trong cả 3 workflow).

**apps trên disk (đã xác minh):** `apps/api`, `apps/auth`, `apps/console`. **`apps/app` KHÔNG tồn tại** — không có package.json. Path-filter hiện tại của apps-frontend.yml đã đúng chỉ liệt kê auth và console; cần bổ sung comment rõ lý do app vắng mặt.

**Stale comment tìm thấy:** dòng 105 của `apps-frontend.yml` — `admin = operator plane, deploy riêng nếu cần` — nằm trong comment deploy placeholder. Đây là tham chiếu tới app `admin` (operator plane) đã park. Cần xoá.

---

## 1. Deviation branch model — ghi chính thức

DEVOPS-02 §6.1/§9.1/§10 khuyến nghị mô hình `develop → main`. Repo hiện dùng `master` làm nhánh chính duy nhất (không có `develop`).

**Quyết định:** Giữ `master` làm nhánh tích hợp duy nhất.

**Lý do:** Dự án đang ở giai đoạn N=1 single-tenant, team nhỏ, vận hành solo-owner. Tách `develop` tạo overhead merge mà không mang lại giá trị bảo vệ thực tế ở quy mô này. Branch protection trên master + PR bắt buộc + CI gate thay thế đủ. Nếu team mở rộng hoặc chuyển sang multi-tenant SaaS, quyết định này được xem xét lại và ghi ADR riêng.

**Tác động lên workflow:** Tất cả ci trigger đã có `branches: [master, main]` — không cần sửa. Không mở nhánh `develop`. Ghi chú này là nguồn sự thật cho deviation.

---

## 2. Phạm vi thay đổi (CHỈ additive — KHÔNG xoá gate nào)

### A. `apps/api/src/db/check.ts` (file mới)

Script kiểm tra drift migration: migrate lên DB rỗng qua `DATABASE_DIRECT_URL`, đọc `migrations/meta/_journal.json`, assert `entries[last].idx === EXPECTED_HEAD_IDX` (hằng số = `121`). In kết quả rõ ràng:

```
[db:check] head idx: 121 — OK
```

hoặc:

```
[db:check] FAIL: expected idx 121, got <actual>
```

Exit 0 khi khớp; exit 1 khi lệch hoặc khi migrate thất bại. Không cần DB thật để chạy trong CI — dùng service Postgres ephemeral giống `db:migrate`.

**Cập nhật hằng số khi có migration mới:** `EXPECTED_HEAD_IDX` phải được cập nhật thủ công mỗi khi có migration mới để script tiếp tục hoạt động đúng. Bước này nằm trong DoD của mỗi WO migration.

### B. `apps/api/package.json` — thêm script

```json
"db:check": "tsx src/db/check.ts"
```

Không đụng script nào hiện có. Thêm additive vào block `scripts`.

### C. `.github/workflows/ci.yml` — thêm bước migration-check

Sau bước `Apply migrations (real Postgres)` (dòng ~87), chèn:

```yaml
- name: Migration check (db:check)
  run: pnpm --filter @mediaos/api db:check
```

Chạy cùng Postgres ephemeral, cùng `DATABASE_DIRECT_URL`. Pass/fail đo bằng exit code — CI tự đỏ nếu check thất bại.

Sau bước `Test (unit + integration RLS/auth)` (cuối file), thêm comment DEFER:

```yaml
# DEFER → S0-CI-2: secret-scan (gitleaks/trufflehog) + dependency-scan (Trivy/Dependabot)
# Defer có chủ đích, KHÔNG bỏ qua silently. DEVOPS-02 §9.2/§11/§17.2 liệt kê cả hai là bắt buộc.
# WO S0-CI-2 (depends_on S0-CI-1) sẽ bổ sung hai job này vào pipeline này.
```

### D. `.github/workflows/api.yml` — thêm bước migration-check + comment DEFER

Cùng pattern với ci.yml: sau bước `Apply migrations` chèn bước `db:check`; cuối file thêm comment DEFER tương tự.

### E. `.github/workflows/apps-frontend.yml` — xoá comment thừa + thêm TODO

Dòng 105 — xoá đoạn `admin = operator plane, deploy riêng nếu cần.` khỏi comment. Câu gốc:

```
# rồi gắn custom domain (runbook §2). admin = operator plane, deploy riêng nếu cần.
```

Thành:

```
# rồi gắn custom domain (runbook §2).
```

Trong block `filters` của job `changes`, thêm comment giải thích app vắng mặt:

```yaml
# TODO(S0-CI-2-FE): thêm entry 'app' khi apps/app/package.json tồn tại (WO FE-APP-SCAFFOLD).
# apps/app CHƯA được tạo — kích hoạt trước sẽ khiến matrix build fail với package không tìm thấy.
```

---

## 3. Bất biến giữ nguyên (KHÔNG hồi qui)

- **BẤT BIẾN #1 — tenant isolation:** `DATABASE_URL` trong CI tiếp tục trỏ tới role `mediaos_app` (NOSUPERUSER, NOBYPASSRLS). Không nới quyền role CI.
- **BẤT BIẾN #2 — migration RLS trước test:** Thứ tự trong ci.yml giữ nguyên — `Apply migrations` (tạo bảng + RLS policy + FORCE) → `db:check` → `Setup DB role passwords` → `Start PgBouncer` → `Test`. Không đảo thứ tự.
- **BẤT BIẾN #3 — no-secret:** Không thêm secret nào vào workflow. Env `DATABASE_DIRECT_URL`, `APP_DB_PASSWORD`, `WORKER_DB_PASSWORD` là ephemeral CI — đã có, không thêm mới. `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` vẫn là placeholder (`secrets.*`).
- **KHÔNG tắt kiểm tra:** Cấm `@ts-ignore`/`eslint-disable`. Cấm bỏ gate hiện có để "xanh giả". `db:check` PHẢI thực sự migrate + assert — không phải `echo OK`.

---

## 4. Deviation giữ nguyên (KHÔNG churn)

- `turbo.json` — cấu trúc `build` / `typecheck` / `test` / `lint` / `dev` hiện tại đủ dùng; không thêm pipeline task.
- `pnpm-workspace.yaml` — `apps/*` đủ; khi `apps/app` được tạo, workspace tự nhận không cần sửa.
- `apps-frontend.yml` matrix strategy — `fromJSON(needs.changes.outputs.apps)` đúng; khi filter thêm `app`, matrix tự mở rộng.

---

## 5. Verify (DB cô lập theo lane)

```bash
bash scripts/lane-db-setup.sh ci1
export LANE_DB=mediaos_ci1
export DATABASE_DIRECT_URL=postgres://mediaos:postgres@localhost:5432/mediaos_ci1

# Bước 1: migrate sạch
pnpm --filter @mediaos/api db:migrate

# Bước 2: migration-check — phải in "head idx: 121 — OK" và exit 0
pnpm --filter @mediaos/api db:check

# Bước 3: bộ test đầy đủ
pnpm --filter @mediaos/api test

# Bước 4: build toàn workspace
pnpm build

# Bước 5: lint + typecheck
pnpm lint
pnpm typecheck

# Bước 6: xác nhận path-filter apps-frontend.yml không chứa 'app'/'web'/'admin'
grep -n "app:\|web:\|admin:" .github/workflows/apps-frontend.yml
# Kết quả mong đợi: không có dòng nào khớp (ngoài comment)
```

Đích: `db:check` exit 0 + in `head idx: 121`; tất cả test xanh; lint/typecheck xanh; build xanh; grep không ra entry path-filter nào ngoài auth và console.

---

## 6. Gate

LIGHT (thay đổi DEVOPS/workflow/package.json — không chạm permission/RLS/secret/audit/migration): `typescript-reviewer` + `quality-gate`. Không cần người chốt thủ công trước merge (zone xanh, auto-merge đủ nếu CI pass + 1 review).

---

## 7. Out-of-scope (KHÔNG làm ở WO này)

- `db:check` không cần viết test riêng — script tự assert và exit code là gate đo được.
- Secret-scan (gitleaks/trufflehog) + dependency-scan (Trivy/Dependabot) → **S0-CI-2** (đã có trong backlog, depends_on S0-CI-1). Defer có ticket — KHÔNG silently narrow DEVOPS-02 §9.2/§11/§17.2.
- Docker build smoke → **S0-CI-2** hoặc sau.
- Scaffold `apps/app` (Vite SPA vỏ nghiệp vụ hợp nhất) → WO riêng (FE-APP-SCAFFOLD); khi done, bổ sung entry `app` vào path-filter.
- Thay đổi branch model (nếu cần mở `develop`) → ADR riêng, không thuộc S0-CI-1.
