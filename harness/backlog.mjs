// harness/backlog.mjs — NGUỒN SỰ THẬT DUY NHẤT cho Work Order ĐANG HÀNH (máy đọc, zero-dep).
//
// Đọc bởi:
//   - harness/gen-status.mjs        → sinh docs/STATUS.md ("đang ở đâu, làm gì kế")
//   - .claude/hooks/guard-scope.mjs → cảnh báo khi sửa file NGOÀI `paths` của item in_progress
//   - .claude/workflows/auto-loop.mjs + harness/ledger.mjs (overlay status từ activity.jsonl)
//
// ─────────────────────────────────────────────────────────────────────────────
// REBUILD 2026-06-22 — kế hoạch tổng thể dựng lại theo BỘ DOCS GOLD-STANDARD.
//   Kế hoạch tổng thể (canonical, KHÔNG nhân bản vào đây):
//     docs/IMPLEMENTATION/IMPLEMENTATION-01..10  → roadmap 7 sprint (S0–S6) + execution plan
//     docs/IMPLEMENTATION/IMPLEMENTATION-02       → 112 story / 869 point (EPIC-00→11) + AC
//     docs/ISSUE-BOARD/ISSUE-BOARD-01 §18         → "Initial MVP backlog seed" (~120 ticket)
//     docs/PROJECT-BASELINE/PROJECT-BASELINE-01   → freeze checklist
//     docs/plans/MVP-MASTER-PLAN.md               → điểm vào + chính sách pull-sprint
//
//   QUY ƯỚC: file NÀY chỉ giữ Work Order của SPRINT HÀNH (hiện = S0–S1). Khi S0–S1
//   hội tụ, PULL sprint kế (S2…) từ ISSUE-BOARD-01 §18 + IMPLEMENTATION-05.. vào đây.
//   KHÔNG nhồi cả 7 sprint vào backlog (chống phình; docs là nguồn sự thật).
//
//   RECONCILE-FIRST: code hạ tầng đã build (RLS·permission·audit·outbox + một phần
//   Foundation service: audit/holidays/files/sequences/retention/seed; head migration
//   idx 121 / 0438). Mỗi WO = "đối chiếu/align <X> với spec mới, GIỮ phần khớp, chỉ
//   build phần thiếu/lệch". Khi code cũ mâu thuẫn spec → SPEC THẮNG (DB-08/BACKEND/API).
//
//   De-media-fy giữ nguyên: media·finance·SaaS·workflow-DAG·payroll·mobile = OUT-OF-SCOPE.
//   Lịch sử WO v2/de-media-fy đã đóng: xem git + harness/_journal.json (KHÔNG liệt lại đây).
// ─────────────────────────────────────────────────────────────────────────────
//
// Schema 1 item:
//   id          : mã ngắn ổn định <MODULE>-<LAYER>-<n> (ISSUE-BOARD-01 §8)        — string, bắt buộc
//   module      : mã module ISSUE-BOARD-01 §8.2 (PROJECT·FOUNDATION·AUTH·HR·ATT·LEAVE·TASK·NOTI·DASH·FRONTEND·BACKEND·QA·DEVOPS·RELEASE) — dashboard nhóm thẻ. Thiếu → suy từ id/title/paths.
//   layer       : mã layer ISSUE-BOARD-01 §8.3 (DOC·DB·API·BE·FE·UI·QA·DEVOPS·SEC·PERF·INT·REL)                                       — dashboard chip lớp. Thiếu → suy từ paths/title.
//   title       : một câu mô tả                                                   — string, bắt buộc
//   zone        : 'green' | 'yellow' | 'red'   → model/gate/autonomy (policy.md)
//   status      : 'todo' | 'in_progress' | 'done' | 'blocked'
//   paths       : glob[] file/vùng ĐƯỢC PHÉP đụng (guard-scope dùng)
//   skills      : string[] skill gợi ý sẵn cho việc này
//   depends_on  : id[] phải 'done' trước khi item này 'ready'
//   done_when   : string[] tiêu chí HỘI TỤ (đích để dừng; verify chứng minh)
//   src         : string[] tài liệu nguồn (trace về docs — bắt buộc theo ISSUE-BOARD §5.2)
//   plan        : string?  trỏ micro-plan ĐÃ LƯU (docs/plans/<id>.md). auto-loop ĐỌC + reconcile-refresh
//                          thay vì phân rã lại từ đầu; chưa có → tạo RỒI LƯU vào đây. Mặc định docs/plans/<id>.md.

export const meta = {
  project: "Hệ thống Quản lý Doanh nghiệp nội bộ (Enterprise Management System) — MVP v1.0",
  spec: "Nguồn sự thật sản phẩm = docs/spec/ (SPEC-01…08) + bộ docs/ gold-standard (DB·API·UI·FRONTEND·BACKEND·QA·DEVOPS). MVP = AUTH·HR·ATT·LEAVE·TASK·DASH·NOTI.",
  plan: "Kế hoạch tổng thể (rebuild 2026-06-22) = docs/IMPLEMENTATION-01..10 + docs/ISSUE-BOARD-01 + docs/PROJECT-BASELINE-01 — 7 sprint (S0–S6), EPIC-00→11, 112 story / 869 point. backlog.mjs CHỈ giữ WO sprint hành (S0–S1); pull sprint kế từ ISSUE-BOARD §18. Điểm vào: docs/plans/MVP-MASTER-PLAN.md.",
  foundation:
    "Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.",
  direction:
    "Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.",
  brain:
    "Điều phối đa-agent (decompose/route/review/escalate) dùng .claude/workflows/parallel-lanes.mjs · auto-loop .claude/workflows/auto-loop.mjs.",
};

export const backlog = [
  // ════════════════════ SPRINT 0 — Readiness & Baseline reconciliation ════════════════════
  // IMPLEMENTATION-03 · EPIC-00/09 + DB nền + AUTH-DB + CI/env. Mục tiêu: team code/build/test/deploy-dev được.
  {
    id: "S0-GOV-1",
    module: "PROJECT",
    layer: "DOC",
    title:
      "Governance: chuẩn hoá board/label/DoR/DoD + chốt backlog harness theo ISSUE-BOARD-01 (master-plan pointer)",
    zone: "green",
    status: "todo",
    paths: ["harness/**", "docs/plans/**", "docs/STATUS.md", ".claude/**"],
    skills: [],
    depends_on: [],
    src: ["IMPLEMENTATION-03", "ISSUE-BOARD-01 §5-15", "IMPLEMENTATION-02 §5-6 (DoR/DoD)"],
    done_when: [
      "backlog.mjs + docs/plans/MVP-MASTER-PLAN.md phản ánh đúng kế hoạch mới (7 sprint, pull-sprint policy); STATUS regen khớp",
      "DoR/DoD + label taxonomy (module/layer/priority/sprint/scope) ghi rõ ở master-plan, trace về ISSUE-BOARD-01",
      "mọi WO trong file này có src[] trace về docs nguồn (ISSUE-BOARD §5.2)",
    ],
  },
  {
    id: "S0-CI-1",
    module: "DEVOPS",
    layer: "DEVOPS",
    title:
      "CI BE/FE: đối chiếu lint·typecheck·test·build + migration-check + path-filter (api/auth/console/app) với DEVOPS-02",
    zone: "green",
    // CLOSE 2026-06-23: deliverables RIÊNG xanh — db:check journal-invariant (head đọc động) + CI migration-check
    //   + app path-filter + file-policy fixture fix (commit a4a1174/a07461d). DoD §8 "toàn API suite xanh" KHÔNG áp
    //   cho WO hạ-tầng-CI này: 60 fail PRE-EXISTING (parked finance/workflow · webhooks/ui-config chưa mount ·
    //   migration-smoke 'sessions' chờ S0-AUTH-DB-1) đã TÁCH sang S1-QA-DEBT-1 + S1-INT-MOUNT-1.
    status: "done",
    paths: [".github/workflows/**", "turbo.json", "package.json", "pnpm-workspace.yaml"],
    skills: ["code-review"],
    depends_on: [],
    src: ["ISSUE-BOARD-01 §18.11 (DEVOPS-CI-001/002)", "DEVOPS-02", "IMPLEMENTATION-01 §16.2"],
    plan: "docs/plans/S0-CI-1-reconcile.md",
    done_when: [
      "pipeline PR pnpm+turbo: lint → typecheck → unit test → build → migration-check (script db:check = migrate DB trống + kiểm BẤT BIẾN journal forward-only/no-gap/no-dup, head đọc ĐỘNG từ _journal.json — KHÔNG hard-code idx) — mỗi cổng pass/fail đo được",
      "path-filter: api.yml→apps/api; apps-frontend.yml→auth+console+app (apps/app ĐÃ có package.json → entry 'app' KÍCH HOẠT, có CI coverage); KHÔNG còn trỏ web/admin park",
      "branch model = master (nhánh chính single-tenant) — trigger master/main giữ; ghi rõ quyết định lệch DEVOPS-02 (develop/main) ở plan",
      "secret-scan + dependency-scan ĐÃ hiện thực ở S0-CI-2 (security.yml); ci.yml/api.yml chỉ thêm comment DEFER trỏ S0-CI-2, KHÔNG trùng lặp",
    ],
  },
  {
    id: "S0-CI-2",
    module: "DEVOPS",
    layer: "SEC",
    title:
      "CI security gates: secret-scan (gitleaks/trufflehog) + dependency-scan (pnpm audit) theo DEVOPS-02 §9.2/§11/§17.2",
    zone: "yellow",
    // CLOSE 2026-06-23 (7325866): 2 cổng XANH thật (không hạ ngưỡng). secret-scan = docker gitleaks v8.30.1
    //   honor .gitleaks.toml (thay action không honor) → 0 leaks. dependency-scan = pnpm audit --audit-level=high
    //   exit 0 sau khi bump 5 high (drizzle 0.45.2/multer 2.2/nodemailer 9.0.1 + ws/form-data/multer overrides).
    //   FOLD IN S0-DEP-BUMP-1 (plan §7 từng defer): drizzle 0.45 bọc error → .cause → vá shared common/db-error.ts
    //   (pgErrorCode walk-cause) cho ~13 service + db-error.spec; full suite 2276 pass. FULL gate: security-reviewer
    //   PASS (3 finding MEDIUM/LOW đã vá: gitleaks pin tag + db-error coverage + PG_CHECK dedup).
    //   CÒN LẠI repo-admin: đăng ký 'Secret scan'/'Dependency scan' là required check trên branch protection (plan §4).
    status: "done",
    plan: "docs/plans/S0-CI-2.md",
    paths: [".github/workflows/**", ".gitleaks.toml"],
    skills: ["code-review"],
    depends_on: ["S0-CI-1"],
    src: ["DEVOPS-02 §9.2/§11/§17.2", "ISSUE-BOARD-01 §18.11"],
    done_when: [
      "secret-scan (gitleaks HOẶC trufflehog) chạy trên PR + push; fail build khi phát hiện secret (BẤT BIẾN #3)",
      "dependency-scan (pnpm audit --audit-level=high hoặc tương đương) là cổng PR; ngưỡng fail ghi rõ",
    ],
  },
  {
    id: "S0-ENV-1",
    module: "DEVOPS",
    layer: "DEVOPS",
    title:
      "Hạ tầng local: đối chiếu docker compose (Postgres/PgBouncer/Valkey/MinIO) + .env.example với DEVOPS-03/04",
    zone: "green",
    // done (ENV-FIX-1 d17f20d sửa root-cause PgBouncer: map 6432:5432 + healthcheck -p 5432 → host :6432 = đích
    // DATABASE_URL/RLS thông; ENV-FIX-2 6724b92 khôi phục docs/adr + SYSTEM-DESIGN). 2 done_when đối chiếu đạt.
    status: "done",
    paths: ["docker-compose.yml", ".env.example"],
    skills: [],
    depends_on: [],
    src: ["ISSUE-BOARD-01 §18.11 (DEVOPS-ENV-001)", "DEVOPS-03", "DEVOPS-04"],
    done_when: [
      "pnpm db:up dựng đủ Postgres + PgBouncer(transaction-mode) + Valkey + MinIO; health xanh",
      ".env.example đủ biến (DATABASE_URL/DIRECT_URL, Valkey, S3/MinIO) khớp DEVOPS-04; không secret thật",
    ],
  },
  {
    id: "S0-FND-DB-1",
    module: "FOUNDATION",
    layer: "DB",
    title:
      "Đối chiếu schema nền (companies·modules·settings·sequence·audit·files·file_links·holidays) + RLS+FORCE với DB-01/DB-08",
    zone: "red",
    // CLOSE 2026-06-23: deliverable ĐÃ committed (cda2a09 — mig 0438 + 11 cột §8.5 + RED append-only test).
    //   3 done_when VERIFIED trên lane DB sạch (mediaos_fnddb1, migrate 0000→0438): rls-coverage-assert/rls-guards/
    //   foundation-tables-tenant-deny (✓19) + audit-logs-appendonly (✓3 insert-ok/update-delete-denied). FULL gate
    //   PASS: security-reviewer (additive-only, 3 bất biến extended-not-weakened) + rls-tenant-isolation-tester
    //   (ISOLATION INTACT — 115/115 company_id table RLS+FORCE+policy; app role NOSUPERUSER+NOBYPASSRLS). WO chỉ
    //   verify+gate+close (KHÔNG build mới — 0438 đã có; tạo migration mới = vỡ journal idx). data_scope CHECK +
    //   pgbouncer-isolation spec là LOW → S1-FND-AUDIT-1 / follow-up.
    status: "done",
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**", "apps/api/test/integration/**"],
    skills: ["code-review"],
    depends_on: [],
    src: ["ISSUE-BOARD-01 §18.2 (FOUNDATION-DB-001..003)", "DB-01", "DB-08", "DB-10"],
    plan: "docs/plans/S0-FND-DB-1-reconcile.md",
    done_when: [
      "mọi bảng company-scoped có company_id NOT NULL + RLS ENABLE+FORCE + policy company_id (CLAUDE.md §3); rls-registry đăng ký đủ",
      "shape bảng nền khớp DB-08 (audit_logs §8.5, files §8.6-8.8, settings §8.3-8.4, sequence §8.9, holidays §8.10); migration nối tiếp head cho phần lệch — KHÔNG db:generate drop",
      "append-only audit_logs/file_access_logs: app role REVOKE UPDATE/DELETE — RED test ghi-rồi-update FAIL (BẤT BIẾN #2)",
    ],
  },
  {
    id: "S0-FND-SEED-1",
    module: "FOUNDATION",
    layer: "DB",
    title:
      "Seed module catalog (MVP active · Phase inactive) + default system/company settings idempotent (ON CONFLICT)",
    zone: "red",
    // CLOSE 2026-06-23 (VERIFY-CLOSE, KHÔNG build): đã seed ở mig 0435 + framework seed-tracking (checksum).
    //   Live DB (lane) xác nhận: modules MVP active = AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI; Phase inactive =
    //   AI/ASSET/CHAT/MOBILE/PAYROLL/RECRUIT/ROOM/SOCIAL (bảng `modules` chuẩn, KHÔNG system_modules SaaS).
    //   system_settings: file.max_upload_size_mb/allowed_mime_types + system.default_timezone/locale +
    //   audit.default_retention_days. Idempotent: 0435 ON CONFLICT DO NOTHING (modules: (module_code) WHERE
    //   deleted_at IS NULL; settings: (setting_key) WHERE status='Active'). Test: foundation-seed-idempotent ✓4 +
    //   migration-smoke ✓59 (clean migrate 0000→0438). Non-sensitive config → đóng nhẹ (không cần FULL gate).
    status: "done",
    paths: ["apps/api/src/foundation/seed/**", "apps/api/migrations/**"],
    skills: ["code-review"],
    depends_on: ["S0-FND-DB-1"],
    src: ["ISSUE-BOARD-01 §18.2 (FOUNDATION-DB-004)", "DB-08 §8.2", "DB-10", "IMP02-STORY-006/012"],
    done_when: [
      "seed modules catalog: AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI active; PAYROLL.. inactive (bảng modules CHUẨN spec, KHÔNG system_modules SaaS)",
      "seed default settings (file.max_upload_size_mb, allowed_mime_types, system.default_timezone/locale, audit.retention_days) ON CONFLICT DO NOTHING",
      "chạy lại seed KHÔNG nhân đôi (idempotent — verify từ DB trống + DB hiện có)",
    ],
  },
  {
    id: "S0-AUTH-DB-1",
    module: "AUTH",
    layer: "DB",
    title:
      "Đối chiếu AUTH/RBAC schema (users·sessions·password_reset·login_log·roles·permissions·user_roles·role_permissions) + seed matrix với DB-02",
    zone: "red",
    // CLOSE 2026-06-23 (VERIFY-CLOSE, KHÔNG migration): plan-review lật §2 — 3 cặp "thiếu" là QUYỀN-MA, đã ship
    //   tên khác: (lock/unlock,user)=suspend:user (0430), (assign,role)=change-role:role (0005:216). Catalog AUTH
    //   ĐỦ; live DB xác nhận company-admin có đủ grant sensitive cho feature đã ship; RLS+FORCE+cross-tenant-deny
    //   cho roles/role_permissions/user_roles đã verify (115/115 bảng, S0-FND-DB-1 run). Tạo 0439 = seed quyền-ma +
    //   churn journal → KHÔNG làm. DEFER: company-admin chưa có change-role:role (leo thang; chưa có endpoint dùng)
    //   → cấp KÈM endpoint quản-permission-của-role (owner chốt: defer 2026-06-23). data_scope/permission_code DEFERRED.
    status: "done",
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "ISSUE-BOARD-01 §18.3 (AUTH-DB-001..003)",
      "DB-02",
      "SPEC-02",
      "API-10 PERMISSION MATRIX",
    ],
    plan: "docs/plans/S0-AUTH-DB-1-reconcile.md",
    done_when: [
      "GIỮ engine 4-tier (action,resource_type,effect) — KHÔNG đổi shape; data_scope (DB-02) KHÔNG biểu diễn được ở engine hiện tại = DEFERRED (ghi note, không churn)",
      "seed DANH SÁCH permission AUTH cụ thể (plan liệt kê từng cặp action/resource_type/is_sensitive) + ma trận role→permission SPEC-02/API-10, ON CONFLICT DO NOTHING; verify đếm đúng số cặp đã seed",
      "permission sensitive MỚI (migration này thêm) KHÔNG auto-grant cho system role qua wildcard; ngoại lệ đã ship hợp lệ: hr-manager view/update-salary (mig 0019), company-admin assign-role (mig 0140)",
      "RLS company-scope giữ FORCE; deny-path test grant không rò chéo tenant; 1 lane db-migration (KHÔNG parity song song)",
    ],
  },
  {
    id: "S0-API-CORE-1",
    module: "FOUNDATION",
    layer: "API",
    title:
      "Đối chiếu shared config·logger·error-response envelope {success,message,data,meta}·health/health-db·auth context với BACKEND-01",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/src/common/**",
      "apps/api/src/health/**",
      "apps/api/src/main.ts",
      "apps/api/src/app.module.ts",
      "packages/contracts/src/index.ts",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: ["ISSUE-BOARD-01 §18.2 (FOUNDATION-BE-001)", "BACKEND-01", "API-01"],
    plan: "docs/plans/S0-API-CORE-1-reconcile.md",
    done_when: [
      "RESHAPE envelope theo API-01: {success,message,data,meta:{request_id,timestamp}} + pagination block riêng — sửa packages/contracts/src/index.ts (apiResponseSchema) + interceptor; thứ tự contracts→api; S0-FE-API-1 đồng bộ shape (depends)",
      "error-code enum MODULE-ERR-XXX (SPEC-01 §9 / API-01 §13.2) ở common/; map HttpStatus→code; ZodValidationPipe→VALIDATION-ERR-001 với details[] field-level",
      "deny-path test TRƯỚC (RED): no-secret-log (Authorization/password/token redacted) + 5xx KHÔNG lộ stack + auth-context companyId A KHÔNG thấy B (isolation)",
      "GET /api/v1/health + /health/db xanh; auth context qua withTenant/set_config; build + typecheck apps/api + contracts xanh",
    ],
  },
  {
    id: "S0-FE-CORE-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "Đối chiếu FE project structure (auth·console·app) + design token + base component skeleton với FRONTEND-01/02 + UI-05",
    zone: "red",
    // CLOSE 2026-06-23 (VERIFY-CLOSE): apps/app ĐÃ tồn tại (scaffold qua S1-FE-LAYOUT-1/REGISTRY-1) — plan cũ
    //   "apps/app NOT EXISTS" lỗi thời. Audit done_when xanh: token-storage 0 hits · console.log token 0 hits ·
    //   apps/app không import web-core/src trực tiếp · @theme token 34 dòng index.css · boot+i18n smoke có mặt.
    //   Test: app 61 · console 177 · auth 9 + web-core 182 (regression crown) + packages/ui 53 (14 file, ≥1 smoke/
    //   base component). KHÔNG build mới. Token-storage BẤT BIẾN #3 giữ (verify bằng grep — acceptance của plan).
    status: "done",
    paths: [
      "apps/auth/**",
      "apps/console/**",
      "apps/app/**",
      "packages/ui/**",
      "packages/web-core/**",
    ],
    skills: ["frontend-design", "code-review"],
    depends_on: [],
    src: ["ISSUE-BOARD-01 §18.4 (FRONTEND-FE-001/002)", "FRONTEND-01", "FRONTEND-02", "UI-05"],
    plan: "docs/plans/S0-FE-CORE-1-reconcile.md",
    done_when: [
      "apps/app TẠO-MỚI chỉ import API public web-core (bootstrapSession/PermissionGate/useCan) — KHÔNG sửa nội bộ auth/token/permission; vite build + typecheck xanh cả 3 app",
      "design token CSS từ packages/ui import + build xanh ở cả 3 app; ≥1 render/smoke test mỗi base component (Button/Form/Table/Modal/Drawer/Toast/State/PermissionGate)",
      "BẤT BIẾN token-storage: lint/grep chặn localStorage/sessionStorage chứa access/refresh token + KHÔNG console.log token; regression XANH không sửa-để-qua: use-can/permission-gate/api-client/session spec",
      "i18n vi missing-key check + 1 test render chuỗi vi; FULL gate (zone=red) + người chốt",
    ],
  },
  {
    id: "S0-FE-API-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "Đối chiếu API client + query layer + error mapper (401/403/422/500 · request-id · idempotency) với FRONTEND-04",
    zone: "green",
    // CLOSE 2026-06-23 (743edb7 → PR #5): ApiError overload + error-mapper + request-id/idempotency header +
    // query-keys/retry (hàm thuần); 182/182 test + cross-app typecheck xanh; LIGHT gate code-review PASS.
    // Wiring QueryClient.defaultOptions ở apps = follow-up S1-FE-QUERY-WIRE-1.
    status: "done",
    paths: ["packages/web-core/**"],
    skills: ["code-review"],
    // depends S0-API-CORE-1 = DONE (52156cf) → envelope {success,message,data,error,meta} đã lock; blocker gỡ.
    // WIP gốc ở git stash@{1} (run wby3ahcpy bị DỪNG; backlog cũ ghi {0} sai do stash cleanup-tail đè lên):
    // 6 helper untracked, error-mapper dùng ApiError.requestId/.kind nhưng api-client.ts CHƯA cập nhật → shape lệch.
    // Micro-plan đã lập (reshape ApiError + land helper + query-keys/retry) → docs/plans/S0-FE-API-1.md.
    depends_on: ["S0-API-CORE-1"],
    src: ["ISSUE-BOARD-01 §18.4 (FRONTEND-FE-003)", "FRONTEND-04", "API-01"],
    plan: "docs/plans/S0-FE-API-1.md",
    done_when: [
      "api-client inject token + map 401(refresh)/403(forbidden)/422(validation)/500; gắn request-id + idempotency-key",
      "query/cache layer (TanStack Query) + invalidation; validate response bằng Zod contracts",
      "web-core test xanh",
    ],
  },
  {
    id: "S0-QA-1",
    module: "QA",
    layer: "QA",
    title: "Test strategy + verify migrate/seed từ DB trống + test-case matrix skeleton (QA-01/02)",
    zone: "yellow",
    status: "done",
    paths: ["apps/api/test/**", "docs/plans/**"],
    skills: ["code-review"],
    depends_on: ["S0-FND-DB-1"],
    src: ["ISSUE-BOARD-01 §18.2/§18.11 (FOUNDATION-QA-001, QA-DOC-001)", "QA-01", "QA-02"],
    done_when: [
      "migrate + seed chạy sạch từ DB trống (lane DB cô lập) — không lỗi, idempotent",
      "test strategy + smoke checklist + test-data plan ghi rõ; test-case matrix skeleton theo module (QA-02)",
    ],
  },

  // ════════════════════ SPRINT 1 — Foundation services + Frontend shell ════════════════════
  // IMPLEMENTATION-04 · EPIC-01 (FND) + EPIC-09 (FE core). Foundation service đã có một phần → reconcile + lấp gap (settings/company/module-catalog/foundation.module).
  {
    id: "S1-FND-AUDIT-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "AuditService v2 (DB-08 shape) + AuditMaskerService + audit-list/detail API theo permission+data-scope (append-only)",
    zone: "red",
    // closed by lane commits d1181e6 / 45f5aac / f33d4c4 (L1 write-shape · L2 read-contracts · L3 tests)
    status: "done",
    paths: [
      "apps/api/src/foundation/audit/**",
      "apps/api/src/events/audit.service.ts",
      "apps/api/src/events/audit-masker.service.ts",
      "packages/contracts/src/observability.ts",
      "apps/api/test/foundation/**",
    ],
    skills: ["code-review"],
    depends_on: ["S0-FND-DB-1"],
    src: ["IMP02-STORY-008", "BACKEND-04 §9.5", "BACKEND-11 §12", "DB-08 §8.5"],
    done_when: [
      "write() điền đủ field DB-08 (module_code/action/entity/actor_type/sensitivity/result_status), tự tính changed_fields, ghi trong tx withTenant (giữ outbox/append-only)",
      "masker che password/token/secret_ref/identity/bank/storage_path/signed_url TRƯỚC insert — test mask không vỡ diff",
      "GET /foundation/audit-logs(+/{id}) filter module/action/actor/entity/from-to; scope Company chỉ thấy company hiện tại, System mới thấy toàn hệ thống",
      "deny-path RED: Employee → 403; response không chứa token/password/storage_path",
    ],
  },
  {
    id: "S1-FND-SETTING-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "SettingService: precedence company→system→default + /settings/public (lọc is_public, mask is_sensitive) + admin update có audit",
    zone: "red",
    // SVC lane CLOSE 2026-06-24 (S1-FND-SETTING-1-SVC): tầng app apps/api/src/foundation/settings/** đã build
    //   self-contained (SettingsModule imports DatabaseModule+PermissionModule+EventsModule, exports SettingService;
    //   KHÔNG sửa app.module.ts=BE-9). DTO Zod CỤC BỘ (settings.dto.ts) — KHÔNG đụng packages/contracts/settings.ts.
    //   (1) resolveSetting/resolveMany precedence company(Active,deleted_at NULL,withTenant)→system(Active)→default
    //       hard-coded (setting-defaults.ts); resolveMany BATCH ≤2 query (1/bảng) — assert KHÔNG N+1 (unit spy).
    //   (2) GET /settings/public chỉ is_public=true AND is_sensitive=false; secret_ref/secret/encrypted DROP tận
    //       gốc (setting-mask.ts toPublicMap). (3) POST /resolve quyền-aware (PermissionService.can update) — user
    //       thường chỉ public; admin → masked metadata; secret_ref KHÔNG bao giờ ra. (4) PATCH /company-settings/:key
    //       validate value_type+validation_schema → withTenant(tx): old→upsert→AuditService.record COMPANY_SETTING_UPDATED
    //       object_type='company_setting' (mig 0439 CHECK) CÙNG tx (mask+changedFields auto). Mọi route
    //       UseGuards(PermissionGuard) fail-closed (view→GET/POST, update→PATCH).
    //   Verify lane DB mediaos_setting (chain 0000→0439): unit setting.service.spec ✓13 (precedence/public/mask/
    //   validate-deny/audit-1-row) + int settings-permission-leak ✓11 (deny-403 ×3 · leak no-secret_ref · resolve
    //   quyền-aware · tenant-isolation · audit-in-tx 1 row masked changedFields · append-only UPDATE/DELETE DENIED).
    //   typecheck + eslint xanh. CÒN NỢ: wiring SettingsModule vào app (BE-9/S1-FND-WIRE-1) + system-setting PATCH
    //   (system-manage, OPTIONAL) chưa build (để BE-9/QA).
    //   FIX-AUDITNAME (2026-06-24): audit action ĐÃ CHỐT theo SPEC = 'COMPANY_SETTING_UPDATED' (API-09 §1200/§2873
    //   FOUNDATION/CompanySetting). CLAUDE.md: spec thắng khi mâu thuẫn done_when. objectType GIỮ 'company_setting'
    //   (enum DB của CHECK mig 0439, KHÔNG phải nhãn spec). permissionCode GIỮ 'FOUNDATION.SETTING.UPDATE'.
    status: "done",
    paths: ["apps/api/src/foundation/settings/**"],
    skills: ["code-review"],
    depends_on: ["S0-FND-DB-1", "S1-FND-AUDIT-1"],
    src: ["IMP02-STORY-007", "BACKEND-11 §13", "BACKEND-04 §14.2", "DB-08 §8.3-8.4"],
    done_when: [
      "resolveSetting(companyId,key) theo precedence company_settings→system_settings→fallback; resolveMany batch",
      "GET /foundation/settings/public CHỈ trả is_public=true AND is_sensitive=false; KHÔNG bao giờ trả secret_ref/raw secret",
      "PATCH validate value_type + validation_schema, ghi audit COMPANY_SETTING_UPDATED (CHỐT theo SPEC API-09 §1200/§2873; objectType='company_setting' enum DB) old/new/changed_fields trong tx withTenant",
      "deny-path RED: thiếu quyền → 403; public endpoint không lộ sensitive",
    ],
  },
  {
    id: "S1-FND-FILE-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "FileService: upload metadata + StorageAdapter port + FilePolicy (deny-by-default) + link/unlink + download-qua-backend + file_access_log",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/foundation/files/**", "apps/api/src/storage/**"],
    skills: ["code-review"],
    depends_on: ["S0-FND-DB-1", "S1-FND-AUDIT-1"],
    src: ["IMP02-STORY-009", "BACKEND-11 §11", "BACKEND-04 §11.4/§14.4", "DB-08 §8.6-8.8"],
    done_when: [
      "upload ghi metadata (visibility=Private default) + validate size/MIME (KHÔNG tin MIME client) + sanitize filename chống path-traversal",
      "StorageAdapter port (put/get/delete/signedUrl) bọc S3 hiện có; KHÔNG trả storage_path/signed-url dài hạn cho FE",
      "FilePolicy resolver registry dispatch theo (module_code,entity_type) — không resolve được → TỪ CHỐI (deny-by-default); ghi file_access_logs cho private/sensitive",
      "link/unlink validate cùng company + scan_status!=Infected; soft-delete không hard-delete; audit Upload/Link/Unlink/Delete",
    ],
  },
  {
    id: "S1-FND-SEQ-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "SequenceService.nextCode (tx + FOR UPDATE) + preview (không tăng) + reset_policy; concurrency 0-dup",
    zone: "red",
    // CLOSE 2026-06-23 (VERIFY-CLOSE): SequenceService đã build đủ (FOUNDATION-BE-2). nextCode qua withTenant +
    //   repo.lockCounterForUpdateTx (SELECT…FOR UPDATE, KHÔNG MAX+1); previewNextCode đọc KHÔNG lock/mutate;
    //   updateSequence (admin) ghi audit SequenceUpdated trong tx (config-only, không current_value/secret);
    //   reset Never/Yearly/Monthly/Daily theo tz. Test xanh lane DB: sequence-concurrent ✓4 (0-dup) +
    //   sequence-formatter ✓9 + sequence.service ✓15. (Wiring controller = S1-FND-WIRE-1, ngoài scope.)
    status: "done",
    paths: ["apps/api/src/foundation/sequences/**"],
    skills: ["code-review"],
    depends_on: ["S0-FND-DB-1"],
    src: ["IMP02-STORY-010", "BACKEND-04 §14.5", "DB-08 §8.9"],
    done_when: [
      "nextCode trong tx, SELECT ... FOR UPDATE; KHÔNG MAX(code)+1; format prefix/padding/datePattern/suffix + reset Never/Yearly/Monthly/Daily",
      "previewNextCode trả mã kế tiếp KHÔNG mutate counter; admin PATCH sequence ghi audit",
      "integration test N request đồng thời → 0 mã trùng",
    ],
  },
  {
    id: "S1-FND-MODULE-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "CompanyService /company/current (GET/PATCH có audit) + ModuleCatalogService /modules/my-apps (lọc permission+active+setting)",
    // REOPEN 2026-06-24 — gỡ plan_block (auto-loop 00:37). Đã chốt nguồn dữ liệu THẬT, hết "lơ lửng":
    //   • enum: companies_status_chk = ('active','suspended') CHỮ THƯỜNG (mig 0002) — KHÔNG 'Suspended'.
    //   • required_permissions: bảng `modules` (mig 0435, KHÁC system_modules SaaS) có metadata jsonb NHƯNG
    //     seed để NULL ⇒ nguồn = HẰNG MODULE_APP_METADATA[code].requiredAnyPermissions trong service
    //     (route/icon/requiredAny — §8.2), merge trên row DB. KHÔNG bịa cột modules.required_permissions.
    //   • "company setting enabled": key `module.<code>.enabled` (§8.3) đọc qua SettingService precedence
    //     company→system→default (default=true) ⇒ THÊM depends_on S1-FND-SETTING-1 (phụ thuộc ẩn của plan_block).
    //   • deny-path RED viết-TRƯỚC = điều kiện DoD (#6) + micro-plan docs/plans/S1-FND-MODULE-1.md.
    //   zone yellow→red: ghi audit CONFIG_UPDATE + lọc permission ⇒ crown/FULL gate (CLAUDE.md §6).
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/foundation/company/**", "apps/api/src/foundation/module-catalog/**"],
    skills: ["code-review"],
    depends_on: ["S0-FND-SEED-1", "S1-FND-AUDIT-1", "S1-FND-SETTING-1"],
    src: [
      "IMP02-STORY-005/006",
      "BACKEND-04 §8.1/§8.2/§8.3/§9.2/§9.3",
      "DB-08 §8.2",
      "mig 0435 (modules)",
      "mig 0002 (companies_status_chk)",
    ],
    plan: "docs/plans/S1-FND-MODULE-1.md",
    done_when: [
      "GET /foundation/company/current đọc company TỪ AuthContext (bỏ qua company_id nếu client gửi trong body/query); permission FOUNDATION.COMPANY.VIEW (§9.2)",
      "PATCH /foundation/company/current: permission FOUNDATION.COMPANY.UPDATE; ghi audit CONFIG_UPDATE (CompanyUpdated) trong tx withTenant với old/new/changed_fields; KHÔNG ghi audit khi 403",
      "company.status='suspended' (CHỮ THƯỜNG — companies_status_chk mig 0002) → endpoint nghiệp vụ trả 403; tái dùng allow-list status==='active' ở auth path (mig 0430)",
      "GET /modules/my-apps đọc bảng `modules` (mig 0435, KHÔNG system_modules SaaS) WHERE is_active AND deleted_at IS NULL; enabled = SettingService.resolve('module.<code>.enabled', default=true) precedence company→system→default (§8.3); required_permissions = MODULE_APP_METADATA[code].requiredAnyPermissions hằng trong service",
      "Lọc my-apps: enabled AND (requiredAny rỗng → HIỆN | user có ≥1 → HIỆN | thiếu hết → ẨN); recent/favorite chưa có bảng → trả [] + TODO rõ (KHÔNG bịa)",
      "deny-path RED viết-TRƯỚC: (a) PATCH thiếu FOUNDATION.COMPANY.UPDATE → 403 + 0 audit; (b) my-apps user thiếu requiredAny của 1 module → module BỊ LỌC; (c) 2-tenant: company A KHÔNG đọc/ghi company B (withTenant+RLS); (d) PATCH gửi company_id lạ trong body → bỏ qua, ghi đúng tenant AuthContext",
    ],
  },
  {
    id: "S1-FND-WIRE-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "FoundationModule gom (company·module-catalog·settings·audit·files·sequence·holidays·retention·seed) + foundation contracts (Zod) + wire app.module additive",
    zone: "green",
    status: "todo",
    paths: [
      "apps/api/src/foundation/foundation.module.ts",
      "apps/api/src/app.module.ts",
      "packages/contracts/src/foundation/**",
    ],
    skills: ["code-review"],
    depends_on: [
      "S1-FND-AUDIT-1",
      "S1-FND-SETTING-1",
      "S1-FND-FILE-1",
      "S1-FND-SEQ-1",
      "S1-FND-MODULE-1",
    ],
    src: ["BACKEND-11 §10", "BACKEND-04 §22", "IMPLEMENTATION-04"],
    done_when: [
      "FoundationModule gom service Foundation; import vào app.module.ts khối ADDITIVE (KHÔNG rewrite — CLAUDE.md §9.3)",
      "packages/contracts có Zod DTO cho mọi response /foundation/* = nguồn sự thật, dual-build",
      "mọi endpoint /api/v1/foundation/* qua AuthGuard+PermissionGuard; envelope {success,message,data,meta}",
      "build + typecheck apps/api XANH; OpenAPI render endpoint Foundation",
    ],
  },
  {
    id: "S1-FE-LAYOUT-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE shell: Home Portal + App Switcher + Module Workspace layout (topbar/sidebar, permission-based app visibility, dirty-form guard)",
    zone: "green",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**", "packages/ui/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S0-FE-CORE-1"],
    src: ["IMP02-STORY-094", "FRONTEND-05", "UI-06", "UI-07"],
    done_when: [
      "AuthLayout + HomePortalLayout + ModuleWorkspaceLayout (topbar/sidebar/app switcher) responsive theo UI-06/07",
      "app/menu visibility theo permission (KHÔNG hard-code role); dirty-form guard khi rời form chưa lưu",
      "loading/empty/error/forbidden state ở shell; web test xanh",
    ],
  },
  {
    id: "S1-FE-REGISTRY-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "App/route/sidebar registry (permission-driven; metadata permission/scope/module/status — KHÔNG hard-code role)",
    zone: "green",
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["code-review"],
    depends_on: ["S0-FE-CORE-1"],
    src: ["IMP02-STORY-096", "FRONTEND-03", "UI-02"],
    done_when: [
      "app registry + route registry + sidebar registry sinh menu từ metadata (permission/scope/module/status), KHÔNG hard-code theo role",
      "route guard: trái quyền → forbidden; app inactive/thiếu setting → ẩn khỏi switcher",
      "web test registry + guard xanh",
    ],
  },
  {
    id: "S1-FE-QUERY-WIRE-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "Wire QueryClient defaultOptions (retry=shouldRetryQuery + staleTime/gcTime FRONTEND-04 §16) vào apps/*/main.tsx + override X-Client-Version từ build env",
    zone: "green",
    // Tách từ S0-FE-API-1 (scope=packages/web-core/** không sửa được apps): web-core CHỈ export query-keys +
    // shouldRetryQuery (hàm thuần); việc lắp vào `new QueryClient({defaultOptions})` + configureClientVersion
    // ở app NẰM NGOÀI scope WO kia → WO này nhận phần wiring app-level.
    // CLOSE 2026-06-23 (PR #5): RECONCILE done_when ↔ code — apps/auth KHÔNG dùng react-query (SPA login 1-trang)
    //   nên CHỈ app+console lắp QueryClient defaultOptions; hàm thật = configureClientVersion (KHÔNG "configureClient");
    //   thêm VITE_APP_VERSION vào 3 vite-env.d.ts. typecheck+build+test 3 app xanh (app 61 · console 177 · auth 9).
    status: "done",
    paths: ["apps/app/**", "apps/console/**", "apps/auth/**"],
    skills: ["code-review"],
    depends_on: ["S0-FE-API-1"],
    src: ["FRONTEND-04 §16.1-16.3", "FRONTEND-04 §8 (X-Client-Version)"],
    plan: "docs/plans/S1-FE-QUERY-WIRE-1.md",
    done_when: [
      "apps/app + apps/console main.tsx dùng new QueryClient({defaultOptions:{queries:{retry:shouldRetryQuery, staleTime:30_000, gcTime:5*60_000, refetchOnWindowFocus:false}, mutations:{retry:false}}}) — KHÔNG còn QueryClient trần (apps/auth KHÔNG có QueryClient → bỏ qua)",
      "configureClientVersion(import.meta.env.VITE_APP_VERSION) ở cả 3 app main.tsx (web-core giữ default 'web'/'0.1.0' khi env vắng); VITE_APP_VERSION khai trong vite-env.d.ts",
      "web test 3 app xanh; typecheck xanh",
    ],
  },
  {
    id: "S1-QA-FND-1",
    module: "QA",
    layer: "QA",
    title:
      "QA hardening Foundation: permission/scope + file security + sequence concurrency + audit masking + public-settings leak + append-only",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/foundation/**/*.spec.ts", "apps/api/test/foundation/**"],
    skills: ["code-review"],
    depends_on: [
      "S1-FND-AUDIT-1",
      "S1-FND-SETTING-1",
      "S1-FND-FILE-1",
      "S1-FND-SEQ-1",
      "S1-FND-MODULE-1",
    ],
    src: ["QA-05", "QA-06", "BACKEND-04 §18", "CLAUDE.md §6"],
    done_when: [
      "permission/scope: Employee→audit 403; admin thấy company hiện tại 200, company khác 403; my-apps lọc app đúng",
      "file security: .exe đổi đuôi .pdf bị chặn; filename ../../ sanitize; soft-deleted không download; response không lộ storage_path/signed_url",
      "sequence concurrency 0-dup; audit masking không lộ token/password; public settings không trả sensitive",
      "append-only: UPDATE/DELETE audit_logs + file_access_logs bằng app role FAIL (BẤT BIẾN #2); coverage vùng nhạy cảm ≥80%",
    ],
  },

  // ════════════════════ TEST-DEBT triage — tách từ S0-CI-1 ════════════════════
  // S0-CI-1 chạy `pnpm --filter @mediaos/api test` trên DB CÔ LẬP SẠCH (mediaos_ci1) → lộ 60 fail PRE-EXISTING
  // mà lane-DB band-thấp trước đây che (CLAUDE.md §9.5). KHÔNG phải lỗi S0-CI-1 — tách thành WO có chủ.
  {
    id: "S1-QA-DEBT-1",
    module: "QA",
    layer: "QA",
    title:
      "Test-suite triage: xoá/exclude test của module PARKED (de-media-fy: finance·workflow·media) + gate test phụ thuộc WO chưa land — để `pnpm api test` xanh = phạm vi THẬT",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/test/**", "apps/api/src/**/*.spec.ts", "apps/api/vitest.config.ts"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "CLAUDE.md (de-media-fy reframe 2026-06-20)",
      "QA-01",
      "S0-CI-1 (bảng phân loại 60 fail PRE-EXISTING)",
    ],
    done_when: [
      "test của module OUT-OF-SCOPE (finance-cost/revenue/cost-allocation-deny · workflow-lifecycle.e2e · media-era) ĐƯỢC xoá HOẶC exclude qua vitest config với lý do de-media-fy ghi rõ — KHÔNG để fail-giả che suite",
      "migration-smoke 'sessions' assertion GATE sau S0-AUTH-DB-1 (skipIf bảng chưa có) HOẶC chờ S0-AUTH-DB-1 land — KHÔNG fail vì bảng chưa migrate",
      "modules-idempotent re-seed fail điều tra: bug seed thật → sửa; test sai → sửa test (ghi rõ nguyên nhân)",
      "`pnpm --filter @mediaos/api test` XANH (0 fail) trên DB cô lập sạch; fail còn lại CHỈ thuộc WO đang chờ (tracked), KHÔNG phải rác parked",
    ],
  },
  {
    id: "S1-INT-MOUNT-1",
    module: "BACKEND",
    layer: "INT",
    title:
      "Quyết scope + mount-or-skip: webhooks-deny + ui-config-deny đang 404 (module chưa mount) — mount nếu trong MVP, else exclude test có vé Phase",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/src/**", "apps/api/test/**"],
    skills: ["code-review"],
    depends_on: [],
    src: ["S0-CI-1 (bảng phân loại 60 fail PRE-EXISTING)", "SPEC-01 §7/§25 (phase scope)"],
    done_when: [
      "quyết định scope webhooks + ui-config/branding/i18n theo SPEC-01 phase map (MVP vs Phase 5 INTEGRATION): in-scope → mount module + wire route; out-of-scope → exclude deny-test có vé Phase ghi rõ",
      "webhooks-deny + ui-config-deny KHÔNG còn 404-masked: pass (nếu mount) hoặc excluded có lý do phase",
    ],
  },
];
