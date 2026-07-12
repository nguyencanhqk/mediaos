```yaml
wo: S5-DEVOPS-1
zone: yellow
generated_by: auto-loop
reconciled_at: "a868679"
lanes: [{"id":"envExample","task":"Bổ sung placeholder env (RỖNG, gitleaks-clean) vào section admin-seed .env.example (~sau dòng 165): STAGING_SEED_EMPLOYEE/MANAGER/HR/ADMIN_EMAIL & _PASSWORD + STAGING_SEED_COMPANY_SLUG (=demo). PLATFORM_SUPERADMIN_EMAIL/PASSWORD/NAME/COMPANY_SLUG ĐÃ có trong env.schema.ts (min12+superRefine) → thêm placeholder tương ứng vào .env.example (chưa có ở file mẫu). Ghi chú section: seed staging dùng DATABASE_DIRECT_URL trỏ mediaos_dev (BYPASSRLS superuser mediaos); SA 100% qua SuperAdminBootstrapService. TẤT CẢ comment/placeholder, KHÔNG giá trị thật.","builder":"backend-builder","paths":[".env.example"]},{"id":"migverifyScript","task":"scripts/migrate-verify-ephemeral.sh — MIGRATE-FROM-EMPTY trên DB THROWAWAY, mượn pattern scripts/backup-restore-drill.sh: parse DATABASE_DIRECT_URL → admin conn 'postgres' → mint tên EPHEMERAL prefix mediaos_migverify_$ts_$$ → CREATE DATABASE → set DATABASE_DIRECT_URL=<ephemeral> TƯỜNG MINH → chạy db:migrate (0000→head) + db:check (đã assert số .sql==entries.length ĐỘNG, hiện 173) trên ephemeral → DROP trong trap EXIT. GUARD cứng: hàm drop REFUSE (exit≠0) nếu DB name ∈ {mediaos, mediaos_dev}, CHỈ cho drop tên khớp ^mediaos_migverify_. Chỉ admin conn 'postgres' được CREATE/DROP. Chế độ --self-test cho guard. Exit 0=PASS. KHÔNG chạm mediaos/mediaos_dev; byte-identical (mediaos_dev không đổi).","builder":"backend-builder","paths":["scripts/migrate-verify-ephemeral.sh"]},{"id":"seedStaging","task":"scripts/seed-staging-accounts.mjs — NON-DESTRUCTIVE idempotent seed 4 tài khoản (Employee/Manager/HR/company-admin) lên mediaos_dev qua pg.Client DATABASE_DIRECT_URL (superuser mediaos = BYPASSRLS). Đọc STAGING_SEED_* fail-fast + MIN LENGTH>=12 (mirror seed-admin.mjs:52, nhất là company-admin) → thiếu/ngắn = exit≠0 TRƯỚC mọi ghi DB, KHÔNG log mật khẩu/hash. Resolve company theo STAGING_SEED_COMPANY_SLUG (mặc định demo) — NOT NULL else fail. Argon2id (BẤT BIẾN #3). Resolve 4 role theo NAME: company-admin=0001(mig0005), employee=0008(mig0005), manager=0010, hr=0011(mig0444) — system role company_id NULL. SET company_id=<resolved> TƯỜNG MINH ở MỌI INSERT (users + user_roles) + resolve/UPSERT user by (company_id,email) mirror seed-admin.mjs:81. IDEMPOTENCY: user_roles SELECT-then-INSERT filter deleted_at IS NULL (khớp partial index user_roles_active_uq mig0471) — KHÔNG ON CONFLICT. TUYỆT ĐỐI KHÔNG tạo role SA / grant catalog / INSERT-UPDATE-DELETE role_permissions (BẤT BIẾN #3 — SA để SuperAdminBootstrapService). KHÔNG drop/wipe. KHÔNG ghi audit_logs (owner CHẤP NHẬN — mirror demo-seed-base precedent).","builder":"backend-builder","paths":["scripts/seed-staging-accounts.mjs"]},{"id":"ciPsGlue","task":"Ops glue. (1) .github/workflows/api.yml — SỬA additive (KHÔNG file workflow mới; done_when yêu cầu 'job trong api.yml'): api.yml build-test ĐÃ migrate-from-empty (service Postgres throwaway → 'Apply migrations' + 'db:check' dynamic count). THÊM step NAMED 'Migrate-from-empty verify (dedicated ephemeral DB)' chạy bash scripts/migrate-verify-ephemeral.sh dùng CI Postgres service (superuser mediaos có CREATE DATABASE priv, ZERO prod secret) → DB riêng ephemeral, độc lập DB test. Additive, không phá step/job cũ. (2) mediaos.ps1 — thêm wrapper 'm migrate-verify' (chạy script, chặn nếu .env active=prod) + 'm seed-staging' (Import-DevOnlineEnv → node scripts/seed-staging-accounts.mjs, guard chỉ mediaos_dev). KHÔNG rebuild dist mà PROD service (node dist/main) chạy (landmine prod-dist-shared) — dùng pnpm/node script.","builder":"backend-builder","paths":[".github/workflows/api.yml","mediaos.ps1"]},{"id":"runbookDoc","task":"docs/plans/S5-DEVOPS-1.md — runbook: (a) topology PROD (mediaos·API:3100·node dist/main NSSM·Pages/tunnel) ‖ UAT=DEV-ONLINE (mediaos_dev·API:3200·pnpm dev·cian-dev.*, CHUNG 1 docker Postgres) — nhấn mediaos_dev là UAT SỐNG KHÔNG drop/wipe/recreate; (b) thứ tự deploy tay + seed: db:migrate mediaos_dev → seed 4 tài khoản → API up env PLATFORM_SUPERADMIN_* (boot tạo SA idempotent) → smoke 5-role login CHỈ SAU /health 200; (c) map checklist IMPLEMENTATION-08 §10.3; (d) RECONCILE met/deferred: env-formalize+seed+migrate-verify-CI=ĐẠT · deploy-pipeline BE+FE (done_when[0])=KNOWN BLOCKER (GH Environment owner provision) → WO đóng partial/blocked-owner KHÔNG auto-green giả. Kèm khối yaml máy-đọc (lanes/acceptanceChecks/testTasks/steps) để tái dùng.","builder":"backend-builder","paths":["docs/plans/S5-DEVOPS-1.md"]}]
acceptanceChecks: ["migrate-verify-ephemeral.sh: tạo DB prefix mediaos_migverify_<ts>, chạy db:migrate (0000→head) + db:check thành công, rồi DROP DB ephemeral ở trap EXIT — chứng minh exit 0 + \\dl không còn DB ephemeral sau chạy; mediaos_dev BYTE-IDENTICAL (__drizzle_migrations count + users/user_roles rows không đổi).","db:check trong luồng assert số file .sql == entries.length của meta/_journal.json ĐỘNG (hiện 173, head idx 172 tag 0492) — KHÔNG literal; head đọc động. Mutate journal lệch → RED.","GUARD drop: gọi cleanup/self-test với name='mediaos' hoặc 'mediaos_dev' → REFUSE (exit≠0), DB KHÔNG bị drop; chỉ ^mediaos_migverify_ được drop.","CI: .github/workflows/api.yml có step NAMED migrate-from-empty verify chạy trên Postgres service throwaway (DB riêng ephemeral, CREATE DATABASE priv, ZERO prod secret) — additive, KHÔNG file workflow mới, KHÔNG phá build-test/release cũ. (api.yml build-test đã sẵn Apply migrations + db:check migrate-from-empty).","seed-staging SET company_id=<resolved> tường minh MỌI INSERT: COUNT(users WHERE company_id=<resolved>) gồm đủ 4 tài khoản + COUNT(user_roles WHERE company_id=<resolved>)==4; 0 row users/user_roles company_id NULL hoặc company khác.","Idempotency: chạy seed 2 lần → COUNT(users)/COUNT(user_roles) KHÔNG đổi (SELECT-then-INSERT filter deleted_at IS NULL khớp partial index user_roles_active_uq — KHÔNG ON CONFLICT).","Cred qua STAGING_SEED_* fail-fast + MIN>=12 → thiếu/ngắn = exit≠0 TRƯỚC ghi DB; KHÔNG secret baked (gitleaks); KHÔNG log mật khẩu/hash.","Seed KHÔNG tạo role super-admin / KHÔNG grant catalog / KHÔNG INSERT-UPDATE-DELETE role_permissions (grep sạch) — SA 100% qua SuperAdminBootstrapService (env PLATFORM_SUPERADMIN_*).","Thứ tự nghiệm thu chạy được: (a) db:migrate mediaos_dev → (b) seed 4 tài khoản → (c) API up env SA (boot idempotent) → (d) smoke 5-role login CHỈ SAU /health 200.","Deny-path đo được: Employee login 200 nhưng GET /hr/employees → 403; HR + company-admin GET /hr/employees → 200 (positive assert); Manager/SA login 200.","AN TOÀN OPS: không DSN prod trong api.yml/mediaos.ps1 tự-động; wrapper 'm' guard chỉ chạy khi .env active=dev-online; migrate-verify + seed KHÔNG rebuild dist mà PROD service (node dist/main) chạy.",".env.example có PLATFORM_SUPERADMIN_* + STAGING_SEED_* placeholder KHÔNG giá trị thật; docs/plans/S5-DEVOPS-1.md có runbook deploy tay + topology PROD‖UAT + thứ tự seed + Known Blockers (GH Environment=owner) + reconcile met/deferred + §10.3.","check.sh xanh; security-reviewer đọc seed script (BYPASSRLS + explicit company_id + fail-fast cred + không role_permissions), KHÔNG auto-commit LIGHT-green vì seed red-adjacent (argon2id+auth+user_roles)."]
testTasks: ["GUARD refuse-drop test (RED trước): --self-test gọi drop-guard với 'mediaos' và 'mediaos_dev' → assert exit≠0 + DB còn nguyên; với 'mediaos_migverify_x' → cho phép (bats/node smoke).","Migration-count RED test: giả lập journal/.sql lệch → db:check (trong migrate-verify) exit≠0 (bổ trợ check.spec.ts hiện có, KHÔNG literal head).","Seed idempotency integration (DB cô lập LANE_DB): chạy seed 2 lần → COUNT(users/user_roles WHERE company_id=resolved) ổn định; assert 0 row rò company khác / company_id NULL; xác minh user_roles SELECT filter deleted_at IS NULL (tombstone không làm bỏ INSERT).","Seed fail-fast test: thiếu/ngắn(<12) STAGING_SEED_*_PASSWORD (nhất là company-admin) → exit≠0 TRƯỚC bất kỳ ghi DB (không tạo user một phần).","Deny-path RED (permission, viết trước GREEN): Employee token → GET /hr/employees → 403; HR + company-admin → 200 (QA-* verify).","Smoke thứ tự nghiệm thu: sau migrate+seed+boot-SA, 5-role login đều 200 CHỈ SAU /health 200 (KHÔNG ngay sau seed)."]
steps: ["Lane envExample: thêm placeholder PLATFORM_SUPERADMIN_* + STAGING_SEED_* (rỗng, comment) vào section admin-seed .env.example ~sau dòng 165; gitleaks phải sạch.","Lane migverifyScript: viết scripts/migrate-verify-ephemeral.sh mượn backup-restore-drill.sh — mint mediaos_migverify_$ts_$$, CREATE → set DATABASE_DIRECT_URL ephemeral tường minh → db:migrate+db:check → DROP trong trap; GUARD refuse-drop {mediaos,mediaos_dev}, chỉ ^mediaos_migverify_; --self-test.","Lane seedStaging: viết scripts/seed-staging-accounts.mjs — fail-fast STAGING_SEED_* (>=12); resolve company NOT NULL; resolve 4 role theo name (0001/0008/0010/0011); argon2id; UPSERT users by (company_id,email) + user_roles SELECT-then-INSERT filter deleted_at IS NULL với company_id tường minh; KHÔNG chạm role_permissions/SA/audit; KHÔNG drop.","Lane ciPsGlue: SỬA api.yml thêm step migrate-verify chạy script trên CI Postgres service (no prod DSN) + wrapper 'm migrate-verify'/'m seed-staging' guard dev-online; KHÔNG rebuild dist prod.","Lane runbookDoc: viết docs/plans/S5-DEVOPS-1.md (topology PROD‖UAT + thứ tự seed a→d + §10.3 + Known Blockers + reconcile met/deferred) kèm khối yaml máy-đọc.","VERIFY: chạy migrate-verify local (ephemeral tự DROP, guard chặn mediaos_dev, byte-identical) → seed 2 lần (COUNT ổn định) → boot API env SA → smoke 5-role login sau health 200 + deny-path Employee 403 GET /hr/employees; check.sh xanh; security-reviewer đọc seed script."]
```

## RECONCILE-REFRESH (không tái dùng nguyên: 1 gap thật ở lane CI)

File này đã tồn tại trước (snapshot git-status cũ) với khối yaml máy-đọc `reconciled_at=a868679` — đối chiếu lại code hiện tại (head mig 0492, 173 entries).

### Xác minh lại (vẫn đúng)

1. `apps/api/src/db/check.ts` migrate-from-empty + assert ĐỘNG `sqlCount==entries.length` + no-gap/no-dup, head đọc động `entries[last].idx` (172/0492) — migrate-verify chỉ WRAP `db:check` bằng DB ephemeral + drop-guard, KHÔNG viết lại đếm.
2. `seed-admin.mjs` pattern nguyên vẹn: min-length 12 (:52), resolve by `(company_id,email)` (:81), argon2id, SELECT-then-INSERT `user_roles`.
3. mig 0471 `CREATE UNIQUE INDEX user_roles_active_uq ON (user_id,role_id,company_id) WHERE deleted_at IS NULL` + `DROP` full constraint `user_roles_uq` — nên SELECT-then-INSERT filter `deleted_at IS NULL` (KHÔNG `ON CONFLICT`, tránh suy diễn partial-predicate đỏ giả).
4. Role id: company-admin=0001, employee=0008 (mig0005); manager=0010, hr=0011 (mig0444) — đều system role `company_id NULL`.
5. `SuperAdminBootstrapService` (`permission/super-admin-bootstrap.service.ts`) `OnApplicationBootstrap` khi `PLATFORM_SUPERADMIN_EMAIL` set: upsert role super-admin company-scoped + grant TOÀN BỘ catalog trừ `reveal-secret:platform-account` + audit + outbox = writer DUY NHẤT chạm `role_permissions` ⇒ seed script TUYỆT ĐỐI không đụng (BẤT BIẾN #3).
6. `env.schema.ts` ĐÃ có `PLATFORM_SUPERADMIN_EMAIL/PASSWORD(min12)/NAME/COMPANY_SLUG(default demo)` + `superRefine` bắt buộc PASSWORD khi EMAIL set ⇒ KHÔNG cần sửa schema; `STAGING_SEED_*` đọc qua `process.env` trong script standalone (không qua loadEnv) ⇒ cũng không cần schema.
7. `backup-restore-drill.sh` tồn tại (mượn pattern parse URL→admin conn→CREATE temp→trap DROP).
8. `docker-compose.yml` có postgres/pgbouncer/valkey/minio đầy đủ ⇒ KHÔNG cần sửa (dù trong WO paths).

### Gap đóng/đổi (lý do reused=false)

`api.yml` build-test job ĐÃ migrate-from-empty CI-ONLY: service `postgres:17-alpine` throwaway (DB `mediaos`, không phải prod) → step "Apply migrations (ephemeral Postgres)" (0000→head) → step "Migration check (db:check)" (dynamic count assert) → ZERO prod secret. `done_when` yêu cầu "job trong `.github/workflows/api.yml`" — plan CŨ (`ciPsGlue`) tạo FILE MỚI `.github/workflows/migrate-verify.yml`, VỪA trùng lặp máy có sẵn VỪA mâu thuẫn `done_when`. SỬA: `ciPsGlue` → SỬA additive `api.yml` (paths → `.github/workflows/api.yml`, KHÔNG file mới), thêm 1 step NAMED chạy `scripts/migrate-verify-ephemeral.sh` trên CI Postgres service (superuser `mediaos` có CREATE DATABASE priv) = DB riêng ephemeral, độc lập DB test, thoả "DB riêng, CREATE DATABASE priv" — proof from-truly-empty tường minh + reuse script chung cho local helper.

### Bất biến

- #1 `company_id` MỌI INSERT (seed BYPASSRLS ⇒ TỰ set `company_id`, không dựa RLS) — acceptance COUNT theo `company_id=resolved` + 0 rò.
- #2 append-only: KHÔNG drop/wipe `mediaos_dev` (UAT sống); audit do SA-bootstrap tự ghi, staging-seed KHÔNG audit (owner chấp nhận mirror demo-seed-base).
- #3 secret: argon2id, cred qua env fail-fast >=12, `.env.example` placeholder rỗng (gitleaks). KHÔNG đổi schema ⇒ KHÔNG lane db-migration.

### Verify/Gate

WO `zone=yellow` (LIGHT tổng thể) NHƯNG lane `seedStaging` red-adjacent (BYPASSRLS + argon2id + user_roles + auth) ⇒ `security-reviewer` + `silent-failure-hunter` BẮT BUỘC đọc seed (explicit `company_id`, fail-fast, không `role_permissions`), KHÔNG auto-commit LIGHT-green. Test DB cô lập `LANE_DB` cho idempotency/deny-path (`pnpm test` không set `LANE_DB` skip int-spec = false-green). GUARD drop-refuse cần `--self-test` RED trước.

### Thứ tự thi công

Đều `backend-builder`, paths KHÔNG chồng: `envExample` ‖ `migverifyScript` ‖ `seedStaging` song song → `ciPsGlue` (depends_on `migverifyScript`+`seedStaging`: `api.yml` gọi script, `m` wrapper gọi seed) → `runbookDoc` (chốt sau, depends_on tất cả, kèm yaml máy-đọc). KHÔNG migration nối tiếp.

### Out-of-scope (chống scope-creep)

IDOR/field-mask/rate-limit sâu → `S5-SEC-1`; ma trận deny-path đầy đủ role×module → `S5-QA-*`/`S5-QA-GATE-LANEDB-1`; GH Environment + deploy pipeline chuẩn (secrets/environment protection, `done_when[0]`) = KNOWN BLOCKER owner chốt (ghi runbook, WO đóng partial/blocked-owner KHÔNG auto-green). `docker-compose.yml` trong WO paths NHƯNG KHÔNG cần sửa. KHÔNG tạo DB/deploy prod tự động; deploy staging = thủ công/runbook. KHÔNG rebuild dist PROD (prod-dist-shared landmine).
</content>

---

# RUNBOOK — Staging/UAT readiness (S5-DEVOPS-1)

> Phần người-đọc, bổ sung cho khối yaml máy-đọc ở đầu file. Viết theo done_when + IMPLEMENTATION-08 §10.

## (a) Topology thực tế — PROD ‖ UAT (KHÔNG dựng env thứ ba)

Hai stack chạy SONG SONG trên cùng 1 máy Windows + CHUNG 1 docker Postgres (`mediaos-postgres`, :5432):

| | PROD | UAT = DEV-ONLINE |
| --- | --- | --- |
| DB | `mediaos` | `mediaos_dev` |
| API | :3100, NSSM service chạy `node <repo>\apps\api\dist\main` | :3200, `pnpm dev` (HMR) hoặc `m dev-online-fast` (bản build) |
| FE | Cloudflare Pages (`app/auth/console.funtimemediacorp.com`) | Vite qua tunnel (`cian-dev`, `cian-dev-auth`, `cian-dev-console.funtimemediacorp.com`) |
| Vào lệnh | `m deploy-*` · `m prod-env` | `m dev-online` / `m dev-online-fast` · `m dev-online-db` |

**Chốt danh phận: staging/UAT = stack DEV-ONLINE (`mediaos_dev` + `cian-dev.*`).** URL ổn định qua cloudflared tunnel (ingress tạo 1 lần bằng `m dev-online-tunnel`). KHÔNG dựng env trùng thứ ba.

**`mediaos_dev` là UAT SỐNG — KHÔNG drop/wipe/recreate.** Mọi thao tác S5-DEVOPS-1 lên nó đều additive/idempotent (`db:migrate` + seed non-destructive). Nhu cầu "chứng minh migrate chạy từ DB trống" được tách sang DB ephemeral `mediaos_migverify_*` (script tự DROP) — không bao giờ mượn `mediaos_dev` làm chỗ thử.

**Landmine prod-dist-shared:** PROD service chạy thẳng `apps/api/dist` của repo này ⇒ mọi lệnh trong WO này KHÔNG rebuild dist (`m migrate-verify`/`m seed-staging` chỉ gọi bash/node script; muốn chạy UAT bản build dùng `m dev-online-fast` và chấp nhận trade-off đã ghi ở memory).

## (b) Thứ tự deploy tay + seed (chạy đúng THỨ TỰ, không đảo)

```text
0. (tuỳ chọn, khuyến nghị trước mọi đợt UAT)  m migrate-verify
   → chứng minh chuỗi migration 0000→head áp SẠCH từ DB trống trên DB ephemeral tự DROP.
1. m dev-online-migrate            # áp migration mới lên mediaos_dev (KHÔNG tạo DB, KHÔNG seed lại)
2. m seed-staging                  # 4 tài khoản UAT (Employee/Manager/HR/company-admin) — idempotent
   → cred đặt trong .env.dev-online: STAGING_SEED_{EMPLOYEE|MANAGER|HR|ADMIN}_{EMAIL|PASSWORD} (≥12 ký tự)
3. m dev-online  (hoặc m dev-online-fast)     # API :3200 boot với PLATFORM_SUPERADMIN_* trong .env.dev-online
   → SuperAdminBootstrapService tự UPSERT Super Admin (idempotent) — SA KHÔNG seed bằng script.
4. CHỜ https://cian-dev-api.funtimemediacorp.com/api/v1/health trả 200 (hoặc :3200 local)
5. Smoke 5-role login (Employee/Manager/HR/company-admin/SA) — CHỈ SAU khi health 200.
   Deny-path nhanh: Employee token GET /api/v1/hr/employees → 403; HR + company-admin → 200.
```

Ghi chú: bước 2 và 3 hoán đổi được khi công ty `demo` đã tồn tại (seed resolve company theo slug, fail-fast nếu chưa có — lần đầu tiên phải `m dev-online-db` tạo nền rồi mới seed staging).

## (c) Map checklist IMPLEMENTATION-08 §10.3

| §10.3 | Trạng thái | Bằng chứng / lệnh |
| --- | --- | --- |
| FE staging HTTPS ổn định | ✅ | `cian-dev*.funtimemediacorp.com` (tunnel ingress có sẵn) |
| Backend healthcheck pass | ✅ | `GET /api/v1/health` (bước 4 runbook) |
| Migration không lỗi | ✅ | `m migrate-verify` (from-empty, ephemeral) + `m dev-online-migrate` (UAT thật) + CI step "Migrate-from-empty verify" |
| Seed idempotent, không trùng | ✅ | `scripts/seed-staging-accounts.mjs` UPSERT + SELECT-then-INSERT lọc `deleted_at IS NULL`; chạy 2 lần COUNT không đổi |
| Test account login được | ✅ | 4 role seed + SA qua env — smoke bước 5 |
| Role/permission seed đúng | ✅ | 4 SYSTEM role resolve theo name + đối chiếu canonical id (0001/0008/0010/0011), KHÔNG chạm role_permissions |
| NOTI event/template đủ P0 | ⚠ ngoài WO | catalog seed qua migration (0479/0481/0488) — verify thuộc S5-QA-E2E-1 |
| Dashboard widget config đủ | ⚠ ngoài WO | seed 0487+ — verify thuộc S5-QA-E2E-1 |
| Storage test riêng | ⚠ một phần | UAT dùng MinIO local (docker) tách R2 prod; drill upload/download → S5-QA |
| Log request-id truy vết FE→BE | ⚠ một phần | API có request-id middleware; soi xuyên FE→BE → S5-SEC/QA |

## (d) RECONCILE — done_when đạt/hoãn + Known Blockers

**ĐẠT:**
- Env formalize: `.env.example` có PLATFORM_SUPERADMIN_* + STAGING_SEED_* placeholder (rỗng, gitleaks-clean).
- Migration + seed từ DB trống: `scripts/migrate-verify-ephemeral.sh` (guard refuse-drop {mediaos, mediaos_dev} + `--self-test`) chạy local (`m migrate-verify`) + CI (step NAMED trong `api.yml`, Postgres service throwaway, zero prod secret).
- Test account đủ 5 role: 4 qua `scripts/seed-staging-accounts.mjs` (non-destructive idempotent) + SA qua SuperAdminBootstrapService; không secret thật trong repo.
- Topology đối chiếu PROD/DEV-ONLINE: mục (a) — UAT = dev-online, không dựng trùng.

**Pipeline deploy (done_when[0] vế sau) — CHỐT thiết kế 2026-07-12, thay trạng thái blocked-owner cũ:**

- **FE = TỰ ĐỘNG qua Cloudflare Pages** — job `deploy` trong `.github/workflows/apps-frontend.yml` (push master, matrix app đổi, environment `production`, project `web-mediaos`/`auth-mediaos`/`console-mediaos` khớp `06-deploy-pages.ps1`). Gate bằng repo var `DEPLOY_FE_ENABLED` để CI không đỏ khi chưa nạp secret. **Owner bật 1 lần (4 lệnh, xem cuối mục):** tạo CF API token scope Pages:Edit → environment `production` + secret/var → flip `DEPLOY_FE_ENABLED=true`.
- **BE = machine-local BY DESIGN (không phải nợ):** PROD API + Postgres sống trên máy Windows owner (NSSM + docker localhost, chỉ lộ HTTP qua tunnel) — hosted runner không với tới; self-hosted runner bị TỪ CHỐI vì repo PUBLIC (fork PR có thể nhắm `runs-on: self-hosted` = chạy code lạ trên máy prod). BE release = chuỗi lệnh tại máy theo thứ tự job `release` (api.yml) in ra: `git pull` → `m prod-env` → `m migrate` → `m deploy-api` → check health. Đổi quyết định = sửa `api.yml` release + mục này.

Lệnh provision (owner chạy 1 lần — cần quyền admin repo, kèm siết fork-PR approval vì repo public):

```bash
echo '{"deployment_branch_policy":{"protected_branches":true,"custom_branch_policies":false}}' \
  | gh api -X PUT repos/nguyencanhqk/mediaos/environments/production --input -
gh api -X POST repos/nguyencanhqk/mediaos/environments/production/variables \
  -f name=CLOUDFLARE_ACCOUNT_ID -f value=414fefc33c056a60c8772a9b4ab5fc15
gh secret set CLOUDFLARE_API_TOKEN --env production --repo nguyencanhqk/mediaos   # dán token Pages:Edit
gh variable set DEPLOY_FE_ENABLED --body true --repo nguyencanhqk/mediaos
echo '{"approval_policy":"all_external_contributors"}' \
  | gh api -X PUT repos/nguyencanhqk/mediaos/actions/permissions/fork-pr-contributor-approval --input -
```

**Còn HOÃN (ngoài WO):** IMPL08-READY §10.3 các mục ⚠ bảng (c): verify NOTI/DASH seed đủ P0 + storage drill + request-id trace thuộc S5-QA-E2E-1 / S5-SEC-1, không kéo vào WO này (chống scope-creep).

**Rollback (IMPL08-A08):** migration forward-only (không down) ⇒ rollback UAT = deploy lại build cũ (git checkout tag + `m dev-online-fast`); DB giữ nguyên (expand-contract đã là luật ở memory `migration-expand-contract-required`). Sự cố seed: script transaction ROLLBACK toàn phần, không ghi một phần.
