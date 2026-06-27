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
    // CLOSE (sync 2026-06-25): ledger finished — backlog/master-plan seeded; literal synced.
    status: "done",
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
    // CLOSE (sync 2026-06-25): landed 52156cf (envelope reshape); ledger finished.
    status: "done",
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
    //   FIX-RED (2026-06-24): xử 3 điểm QA-FAIL của Đội 3 (vòng sửa) — KHÔNG sửa logic test/service:
    //   (1) RED-before-GREEN ĐÃ CHỨNG MINH (bằng chứng RED, KHÔNG rewrite history): stash service→stub-throw,
    //       chạy 2 spec thấy ĐỎ rồi git checkout khôi phục service THẬT. RED-ORDER THỎA:
    //         • unit setting.service.spec ✓34 fail/34 (stub) → ✓34 pass (real).
    //         • int settings-permission-leak: 5 fail + 7 pass (stub) → 12 pass (real). (7 pass-ở-stub = deny-403 ×4
    //           [PermissionGuard đã-land, không phụ thuộc service] + validate-before-tx + in-tx-rollback + append-only
    //           [drive repo/audit/DB trực tiếp, KHÔNG service-stub] ⇒ đúng: chỉ test HÀNH-VI-SERVICE mới đỏ ở stub.)
    //   (2) TRUE in-tx rollback (QA #2): tách test cũ "business rollback" làm 2 — (a) validate-before-tx (fail-fast,
    //       KHÔNG chạm DB) GIỮ + đổi tên cho đúng nghĩa; (b) THÊM "in-tx rollback: post-audit error rolls back BOTH
    //       upsert AND audit row (same tx)" — upsert company_setting + audit.record(tx) THẬT trong 1 withTenant rồi
    //       THROW SAU audit ⇒ verify CẢ company_settings row LẪN audit_logs row biến mất sau rollback (BẤT BIẾN #2
    //       audit+mutation cùng commit/rollback). Đây ĐÚNG kịch bản QA yêu cầu (lỗi DB-level SAU khi đã ghi audit).
    //   (3) LANE_DB green-evidence (QA #3): chạy THẬT trên DB cô lập mediaos_setting (chain 0000→0439, CHECK có
    //       company_setting+system_setting) — int 12/12 pass (gồm deny-403 ×4 · leak no-secret_ref · resolve
    //       quyền-aware · tenant-isolation · audit-in-tx 1 row masked changedFields · in-tx rollback · append-only
    //       UPDATE/DELETE DENIED). Bằng chứng RED+GREEN lưu scratchpad/RED-evidence.txt.
    //   File chạm (paths lane): setting.service.spec.ts (giữ nguyên logic), settings-permission-leak.int-spec.ts
    //   (split rollback test + thêm true in-tx rollback), backlog.mjs (ghi RED-order thỏa). KHÔNG đụng service/contracts.
    //   FIX-DBEVIDENCE (2026-06-24, Đội 2 — chỉ CHẠY + thu bằng chứng, KHÔNG sửa nguồn): xử QA #3 (integration
    //   gated LANE_DB không ký được nếu skip). Setup DB cô lập: `bash scripts/lane-db-setup.sh setting --reset`
    //   (chain 0000→latest áp SẠCH); CHECK audit_logs.object_type trên mediaos_setting CÓ 'company_setting'+
    //   'system_setting' (mig 0439) ⇒ runIsolatedDb=true & hasType=true ⇒ KHÔNG ctx.skip.
    //   `export LANE_DB=mediaos_setting && pnpm --filter @mediaos/api exec vitest run
    //    test/integration/settings-permission-leak.int-spec.ts --reporter=verbose` ⇒ 12/12 PASS (KHÔNG skip):
    //     • deny-403 ×3: getPublic / resolve / updateCompanySetting thiếu grant → ForbiddenException ✓
    //     • guard ALLOW sanity (company-admin) ✓
    //     • leak: getPublic chỉ public-nonsensitive — KHÔNG co-leak / co-secret-val / vault:// / secret_ref ✓
    //     • resolve quyền-aware: admin → sensitive MASKED '***', no-role → chỉ public; secret_ref KHÔNG bao giờ ra ✓
    //     • tenant-isolation: A resolve co-pub của A, KHÔNG ra 'B-only' của B (RLS) ✓
    //     • audit-in-tx: PATCH → ĐÚNG 1 audit_logs COMPANY_SETTING_UPDATED company_setting, changedFields⊃settingValue ✓
    //     • validate-before-tx: sai value_type → reject TRƯỚC mọi DB-write (count audit+company_settings KHÔNG đổi) ✓
    //     • in-tx rollback (production path): lỗi SAU audit.record() trong cùng withTenant ⇒ CẢ upsert LẪN audit row
    //       rollback (auditAfter==auditBefore, settingAfter==settingBefore) ✓ — đúng kịch bản QA #2.
    //     • append-only: app role UPDATE/DELETE audit_logs → DENIED (BẤT BIẾN #2) ✓
    //   Chứng gate THẬT (không xanh-giả): cùng spec KHÔNG LANE_DB ⇒ 12/12 SKIP (runIsolatedDb=false).
    //   Phụ: unit setting.service.spec ✓34/34; mig 0439 re-run idempotent (no-op, no error); grant audit_logs cho
    //   mediaos_app = chỉ INSERT+SELECT (KHÔNG UPDATE/DELETE); AUDIT_OBJECT_TYPES (schema/audit.ts) khớp CHECK DB.
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
    // CLOSE (sync 2026-06-25): PR #9 merged 9213cdb (FilePolicy/StorageAdapter/file_access_log).
    status: "done",
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
    // CLOSE (sync 2026-06-25): PR #12 merged b72ad10 (company/current + modules/my-apps; FULL gate PASS).
    status: "done",
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
    // CLOSE (sync 2026-06-25): PR #15 merged 9832840 + drift PR #16 ea8fb25 (Foundation S0-S1 hội tụ).
    status: "done",
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
    // CLOSE (sync 2026-06-25): ledger finished — registry.ts metadata-driven (app/route/sidebar) + route guard.
    status: "done",
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
    // CLOSE (sync 2026-06-25): PR #14 merged 1e51374 (QA hardening Foundation).
    status: "done",
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
    // CLOSE (sync 2026-06-25): ledger finished — excluded 4 parked tests (finance×3 + workflow-DAG) via vitest.config.
    status: "done",
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
    // CLOSE (sync 2026-06-25): ledger finished — webhooks→Phase5, ui-config out-of-MVP §7.1; deny-tests excluded w/ phase ticket.
    status: "done",
    paths: ["apps/api/src/**", "apps/api/test/**"],
    skills: ["code-review"],
    depends_on: [],
    src: ["S0-CI-1 (bảng phân loại 60 fail PRE-EXISTING)", "SPEC-01 §7/§25 (phase scope)"],
    done_when: [
      "quyết định scope webhooks + ui-config/branding/i18n theo SPEC-01 phase map (MVP vs Phase 5 INTEGRATION): in-scope → mount module + wire route; out-of-scope → exclude deny-test có vé Phase ghi rõ",
      "webhooks-deny + ui-config-deny KHÔNG còn 404-masked: pass (nếu mount) hoặc excluded có lý do phase",
    ],
  },

  // ════════════════════ SPRINT 2 — AUTH Core + HR Core ════════════════════
  // IMPLEMENTATION-05 · EPIC-02 AUTH (87pt) + EPIC-03 HR (100pt) + EPIC-10 integration (13pt) = 200pt.
  // PULL 2026-06-24: S0–S1 (Foundation) đã hội tụ (PR #14/#15/#16 merged master) → kéo sprint kế theo
  //   quy ước "chỉ giữ sprint hành" (dòng 17-19). Nguồn phân rã = IMPLEMENTATION-05 §9 (epic→story) + §11
  //   (API) + §12 (DB checklist) + §13 (permission matrix) + ISSUE-BOARD-01 §18.3 (AUTH) / §18.5 (HR).
  //   Reconcile-first: code cũ đã có apps/api/src/{auth,permission,users,employees,org,positions} (media-era)
  //   → đối chiếu spec mới, giữ phần khớp, build/sửa phần lệch. SPEC thắng khi mâu thuẫn (DB-02/03·API-02/03·SPEC-02/03).
  //   Thứ tự dependency (IMPLEMENTATION-01 §4): AUTH-DB → AUTH-SEED → AUTH-BE(login/guard) → HR-DB → HR-BE → FE → INT → QA.
  //   Crown/FULL gate cho mọi WO chạm auth·token·permission·data_scope·audit·migration (CLAUDE.md §6) → người chốt.

  {
    id: "S2-AUTH-DB-1",
    module: "AUTH",
    layer: "DB",
    title:
      "RBAC engine: thêm cột role_permissions.data_scope (Own/Team/Department/Company/System) per grant — gỡ nợ DEFERRED của S0-AUTH-DB-1",
    zone: "red",
    // CLOSE 2026-06-24 (a1bee66, nhánh feat/s2-auth-db-1): mig 0441 (idx 124) ALTER role_permissions ADD
    //   data_scope text NOT NULL DEFAULT 'Company' + CHECK 5 giá trị — thuần additive (HOT-FILE §9.3), KHÔNG
    //   đụng RLS/FORCE/policy/grant (mig 0005) → BẤT BIẾN #1 giữ. drizzle permissions.ts: dataScope + ROLE_DATA_SCOPES.
    //   RED→GREEN int (gate hasDb && LANE_DB) 6/6 trên mediaos_verifyss1 (chain 0000→0441 sạch). Seed scope từng
    //   role = S2-AUTH-SEED-1; resolver tiêu thụ scope = S2-AUTH-BE-2.
    status: "done",
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**", "apps/api/test/integration/**"],
    skills: ["code-review"],
    depends_on: [],
    src: ["IMPLEMENTATION-05 §12.1/§13", "ISSUE-BOARD-01 §18.3", "DB-02", "BACKEND-03"],
    plan: "docs/plans/S2-AUTH-DB-1.md",
    done_when: [
      "cột data_scope NOT NULL DEFAULT 'Company' + CHECK IN (Own/Team/Department/Company/System); giữ effect (additive)",
      "schema drizzle đồng bộ; RLS+FORCE role_permissions GIỮ NGUYÊN; backfill 'Company' KHÔNG nới system-role",
      "migrate 0000→head sạch (1 lane db-migration); cross-tenant deny còn xanh; rls-tenant-isolation-tester PASS",
    ],
  },
  {
    id: "S2-AUTH-DB-2",
    module: "AUTH",
    layer: "DB",
    title:
      "Đối chiếu AUTH/RBAC tables vs DB-02 §12.1 (users·user_sessions·password_reset_tokens·login_logs) + user_security_events (nên có) + required indexes",
    zone: "red",
    // CLOSE (sync 2026-06-25): PR #23 merged 616ab45 (sessions/login_logs/security_events; FULL gate PASS×3).
    status: "done",
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**", "apps/api/test/integration/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-DB-1"],
    src: [
      "IMPLEMENTATION-05 §12.1/§12.4",
      "ISSUE-BOARD-01 §18.3 (AUTH-DB-001/002)",
      "DB-02",
      "SPEC-02",
    ],
    done_when: [
      "shape users/user_sessions/password_reset_tokens/login_logs khớp DB-02 §12.1 (failed_login_count/locked_at, token hash, expired_at/used_at, ip/user_agent/reason); migration nối tiếp head cho phần lệch — KHÔNG db:generate drop",
      "user_security_events (event_type/severity/payload) thêm nếu thiếu; company_id NOT NULL + RLS ENABLE+FORCE + policy; rls-registry đăng ký đủ",
      "login_logs/user_security_events append-only (app role REVOKE UPDATE/DELETE) — RED test ghi-rồi-update FAIL (BẤT BIẾN #2); index company/status/email/joined theo §12.4",
    ],
  },
  {
    id: "S2-AUTH-SEED-1",
    module: "AUTH",
    layer: "DB",
    title:
      "Seed permission/role/role_permission VỚI data_scope đúng từng role + bootstrap admin (idempotent ON CONFLICT) theo permission matrix §13 / API-10",
    zone: "red",
    // CLOSE (sync 2026-06-25): PR #24 merged dc9717d (canonical roles + per-pair §13 data_scope + super-admin
    //   bootstrap). FULL red-zone gate PASS + human merge — pending-note cũ đã xong.
    status: "done",
    // Plan: docs/plans/S2-AUTH-SEED-1.md §13 (per-pair data_scope). L1 (db-migration): mig 0444 canonical
    // roles + per-pair seed (commit a7c6a1f). L2 (this lane, SuperAdminBootstrap): runtime seed super-admin
    // company-scoped — apps/api/src/permission/super-admin-bootstrap.{service,repository}.ts wired additive
    // into PermissionModule; unit + LANE_DB int specs GREEN. Pending: FULL red-zone gate + human merge.
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**", "apps/api/src/permission/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-DB-1", "S2-AUTH-DB-2"],
    src: [
      "IMPLEMENTATION-05 §13 (permission matrix)",
      "ISSUE-BOARD-01 §18.3 (AUTH-DB-003)",
      "API-10 PERMISSION MATRIX",
      "SPEC-02",
      "docs/plans/S2-AUTH-SEED-1.md §13",
    ],
    done_when: [
      "Mô hình role: employee(…008)/company-admin(…001)/hr-manager(…009) là SYSTEM role ĐÃ tồn tại (company_id NULL, name globally-unique roles_system_name_active_uq — mig 0005/0019) → KHÔNG tạo trùng; manager/hr = system role MỚI (company_id NULL, is_system=true, ON CONFLICT(name) DO NOTHING). data_scope SEED THEO TỪNG CẶP (action,resource_type,role) đúng BẢNG §13 (docs/plans/S2-AUTH-SEED-1.md) — KHÔNG phẳng theo role. super-admin = role COMPANY-SCOPED do SuperAdminBootstrapService tạo runtime (env PLATFORM_SUPERADMIN_*, argon2id — KHÔNG literal hash/log; full catalog data_scope=System TRỪ reveal-secret/break-glass ADR-0010), KHÔNG seed ở migration; bootstrap từ DB trống đăng nhập được, idempotent (1 user + 1 user_role)",
      "PER-PAIR §13 (KHÔNG flat): CẶP 'Own cho MỌI role' = view:me + create:profile-change-request (employee/manager/hr/company-admin ĐỀU Own; super-admin System) · read:employee(employee=Own·manager=Team·hr/admin=Company) · read:department(employee=Company·manager=Department·hr/admin=Company) · read:position(employee/manager=Company·hr/admin=Company). Vì UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope → ON CONFLICT DO NOTHING KHÔNG sửa scope: cặp ĐÃ có ở scope SAI phải DELETE đúng (role_id,permission_id,effect) RỒI INSERT lại scope §13, BỌC 1 transaction; cặp chưa có = INSERT. ⛔ CẤM blanket DELETE FROM role_permissions WHERE role_id=… (mất grant)",
      "company-admin(…001): HẦU HẾT cặp = Company (ĐÚNG §13 → additive INSERT, ON CONFLICT DO NOTHING); NGOẠI LỆ view:me + create:profile-change-request = Own → nếu đã có ở Company phải DELETE-theo-cặp + INSERT Own (1 transaction). CẤM blanket DELETE. AcceptanceCheck đo được: COUNT grant resource_type LIKE 'foundation-%'/channel/project/content/platform-account/workflow của …001 BẰNG NHAU trước/sau migration (KHÔNG mất grant media/foundation parked — mig 0005/0019/0430/0435)",
      "Sensitive 2 lớp: VIEW_SENSITIVE (field-mask Tầng-4 ở can()) ĐƯỢC grant §13 (employee=Own self/policy-gated · hr/company-admin=Company; manager KHÔNG có); reveal-secret + finance/payroll (out-of-scope) KHÔNG role-grant. Nghiệm thu idempotent ĐO BỘ BA (role_id,permission_id,data_scope) trước/sau — KHÔNG chỉ COUNT (COUNT mù với scope drift); migrate lần 2 từ DB-hiện-có → từng (role,pair,scope) BẤT BIẾN. migration idx 127 (when>head 0443), KHÔNG db:generate; permissions.ts CHỈ append hằng role-id manager/hr (KHÔNG rewrite ROLE_DATA_SCOPES)",
    ],
  },
  {
    id: "S2-AUTH-BE-1",
    module: "AUTH",
    layer: "BE",
    title:
      "Login/logout/me: password verify + session issue/revoke + login_log + GET /auth/me (user·company·roles·permissions·scopes·employee·modules)",
    zone: "red",
    status: "done",
    paths: ["apps/api/src/auth/**", "apps/api/src/permission/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-DB-2", "S2-AUTH-SEED-1"],
    src: [
      "IMPLEMENTATION-05 §9.1 (AUTH-S2-001/002/003) §11.1 §15.1",
      "ISSUE-BOARD-01 §18.3 (AUTH-BE-001/002/003)",
      "IMP02-STORY-013/014/017", // login · logout · view account profile (/auth/me context)
      "API-02",
      "SPEC-02",
    ],
    done_when: [
      "POST /auth/login: verify password hash (KHÔNG plaintext — BẤT BIẾN #3); Active đăng nhập OK; Locked/Inactive → 401 ĐỒNG NHẤT chống status-probing (AUTH-FIX-1 — KHÔNG 403 lộ trạng thái) + ghi login_logs Blocked/failure_reason; sai mật khẩu ghi login_log + tăng failed_login_count, KHÔNG lộ user tồn tại",
      "POST /auth/logout revoke session/refresh; GET /auth/me trả context bootstrap (roles/permissions/scopes=data_scope mạnh nhất/employee mapping/modules) — modules TÁI DÙNG ModuleCatalogService.getMyApps() (KHÔNG re-implement), mask field thiếu quyền (server-side)",
      "session/token strategy theo S2-OQ-001 (HttpOnly cookie); token KHÔNG vào log/DTO role không quyền; deny-path RED: no-token → 401, locked → 401-uniform, no-secret-log",
    ],
  },
  {
    id: "S2-AUTH-BE-2",
    module: "AUTH",
    layer: "BE",
    title:
      "Permission + data-scope resolver guard dùng chung (decorator/middleware): Own/Team/Department/Company/System — lớp kiểm soát quyền cuối cho mọi module",
    zone: "red",
    // IN-PROGRESS 2026-06-25 (feat/s2-auth-be-2, cắt master a0ace35/#26). Chồng lên BE-1: thêm
    //   PermissionService.resolveStrongestScope() (engine, additive) + DataScopeService (scope→predicate
    //   employee_profiles: Own/Team(reports∪self)/Department(org_unit)/Company/System, luôn kèm company_id).
    //   KHÔNG migration (data_scope cột đã có mig 0441). Plan PASS-after-fix (plan-reviewer: exact>wildcard,
    //   không nâng-scope, sensitive mirror can(), isEmployeeInScope tenant-guard, narrowing≠403). paths +
    //   test/integration/** cho int spec LANE_DB. FULL gate + người chốt; KHÔNG push master.
    // CLOSE (sync 2026-06-25): PR #27 merged 38b99ca (resolveStrongestScope + DataScopeService). FULL gate PASS×3.
    status: "done",
    paths: ["apps/api/src/permission/**", "apps/api/src/auth/**", "apps/api/test/integration/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-DB-1", "S2-AUTH-SEED-1"],
    plan: "docs/plans/S2-AUTH-BE-2.md",
    src: [
      "IMPLEMENTATION-05 §9.1 (AUTH-S2-004) §13 §15.1",
      "ISSUE-BOARD-01 §18.3 (AUTH-BE-004)",
      "IMP02-STORY-022", // middleware auth/permission/data-scope guard dùng chung
      "BACKEND-03",
      "API-10",
    ],
    done_when: [
      "PermissionService.can(action,resource) + scope resolver dịch data_scope→điều kiện query (Own=self · Team/Department=cây quản lý · Company=tenant · System=toàn hệ thống); deny-overrides giữ",
      "guard decorator/middleware tái dùng được cho HR API (S2-HR-BE-*) — KHÔNG hard-code role; thiếu quyền → 403 TRƯỚC khi chạm dữ liệu",
      "deny-path RED viết-TRƯỚC: employee chỉ thấy scope Own; cross-tenant deny (RLS+resolver); scope rộng hơn grant → 403; coverage vùng nhạy cảm ≥80%",
    ],
  },
  {
    id: "S2-AUTH-BE-3",
    module: "AUTH",
    layer: "BE",
    title:
      "User admin API (P1): list/detail/create/update + lock/unlock + roles/permissions list (search/filter/paginate)",
    zone: "red",
    // CLOSE (sync 2026-06-25): PR #28 merged c629764 (user-admin API + mig 0450). FULL gate PASS×2
    //   (security-reviewer + DB/silent-failure). LOW follow-ups (LANE_DB gate test) → S2-QA-DEBT-1.
    status: "done",
    paths: ["apps/api/src/users/**", "apps/api/src/permission/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-BE-2"],
    src: [
      "IMPLEMENTATION-05 §9.1 (AUTH-S2-006) §11.2",
      "ISSUE-BOARD-01 §18.3 (AUTH-BE-005..)",
      "API-02",
      "IMP02-STORY-018/019/020/021",
    ],
    done_when: [
      "GET/POST/PATCH /auth/users + lock/unlock có permission guard (AUTH.USER.*); list pagination/search/filter; mật khẩu hash khi tạo",
      "POST /auth/users/{id}/lock|unlock ghi audit + login bị chặn khi locked; GET /auth/roles + /auth/permissions cho UI gán quyền",
      "deny-path RED: thiếu quyền → 403 + 0 audit; 2-tenant không thấy user công ty khác; thao tác quan trọng có audit log",
    ],
  },
  {
    id: "S2-AUTH-BE-4",
    module: "AUTH",
    layer: "BE",
    title:
      "Change-password + forgot/reset-password (P1): token hash + expiry/used_at + email mock; đổi mật khẩu khi đã đăng nhập",
    zone: "red",
    // CLOSE (sync 2026-06-25): PR #29 merged c158bc8 (change/forgot/reset-password hardening). FULL gate
    //   PASS×2 (security + silent-failure). LOW hardening follow-ups → S2-AUTH-HARDEN-1 + test → S2-QA-DEBT-1.
    status: "done",
    paths: ["apps/api/src/auth/**", "apps/api/migrations/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-DB-2", "S2-AUTH-BE-1"],
    src: [
      "IMPLEMENTATION-05 §9.1 (AUTH-S2-007) §11.1 (006/007/008)",
      "API-02",
      "SPEC-02",
      "IMP02-STORY-015/016",
    ],
    done_when: [
      "POST /auth/change-password yêu cầu mật khẩu cũ + verify; POST /auth/forgot-password sinh token HASH (KHÔNG lưu plaintext) + expiry; reset-password validate token chưa dùng/chưa hết hạn → set used_at",
      "email gửi token = mock/log-an-toàn (KHÔNG log token); rate-limit forgot; revoke session sau đổi mật khẩu",
      "deny-path RED: token sai/hết hạn/đã dùng → lỗi chuẩn KHÔNG lộ user tồn tại; no-secret-log",
    ],
  },
  {
    id: "S2-AUTH-BE-5",
    module: "AUTH",
    layer: "BE",
    title:
      "Login-log + security-event viewer (P1): GET /auth/login-logs + /security-events (permission + data-scope + mask) + FE admin viewer — đóng IMP02-STORY-024 (AUTH 12/12)",
    zone: "red",
    // SEED 2026-06-26 (chốt owner): gap THẬT duy nhất của EPIC-02 — bảng login_logs/user_security_events ĐÃ ghi
    //   (S2-AUTH-DB-2 + S2-AUTH-BE-1) nhưng CHƯA có endpoint đọc (auth.controller chỉ có me/2fa/redirect-allowed).
    //   Đọc dữ liệu security → red/FULL gate. KHÔNG chặn Sprint 3 (P1) — chạy xen khi rảnh.
    // WIP 2026-06-27 (FIX-BE5-HARNESS): đang thực thi trên feat/s3-wave1 — endpoint BE + FE viewer đã code (auth-logs-viewer.*).
    //   done_when-evidence (int-spec apps/api/src/auth/auth-logs-viewer.int.spec.ts):
    //     D1/D2 deny (403; wildcard '*:*' KHÔNG kế thừa sensitive) · P3 positive (200 + envelope phân trang) ·
    //     X4 cross-tenant (admin A → user_id B = 0 row, BẤT BIẾN #1 RLS Company-scope) · M5 mask (metadata/payload no-secret) ·
    //     A6 append-only (app-role UPDATE/DELETE login_logs+user_security_events DENIED, BẤT BIẾN #2) ·
    //     V7 validate (status/enum ngoài whitelist → 400 VALIDATION-ERR) · R8 date-range (from/to subset + biên ngoài → 0) ·
    //     E9 event_type (narrow → đúng 1 row) · + 2 case MỚI status (login-logs success-only) / severity (security-events high-only) positive-path.
    //   coverage-gate (vùng nhạy cảm ≥80%, CLAUDE.md §6): apps/api/vitest.config.ts per-file thresholds cho
    //     auth-logs-viewer.controller.ts · auth-logs-viewer.service.ts · login-log.repository.ts · security-event.repository.ts,
    //     ép qua script test:cov:sensitive (apps/api/package.json).
    //   CHỈ flip 'done' SAU: PR mở + FULL gate (security-reviewer + silent-failure-hunter) PASS + người chốt + merge
    //   (red-zone, no auto-merge) — KHÔNG fabricate done sớm.
    status: "in_progress",
    paths: ["apps/api/src/auth/**", "packages/contracts/src/**", "apps/app/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-DB-2", "S2-AUTH-BE-3"],
    src: [
      "IMP02-STORY-024",
      "ISSUE-BOARD-01 §18.3 (AUTH-BE P1)",
      "API-02",
      "SPEC-02",
      "DB-02 (login_logs · user_security_events §12.1)",
    ],
    done_when: [
      "GET /auth/login-logs (+ /auth/security-events) list theo permission AUTH.AUDIT_LOG.VIEW (hoặc tương đương đã seed) + data-scope (admin Company); filter success/failure + from-to + (event_type/severity cho security) + pagination/sort whitelist",
      "response KHÔNG lộ token/secret (mask qua AuditMasker/allowlist); IP/user_agent chỉ trả khi đủ quyền; login_logs/user_security_events chỉ ĐỌC qua API (append-only giữ — BẤT BIẾN #2, KHÔNG endpoint sửa/xoá)",
      "FE admin viewer (apps/app system area): bảng login-log + security-event với filter/pagination + loading/empty/error/forbidden; KHÔNG hard-code role (PermissionGate/useCan)",
      "deny-path RED viết-TRƯỚC: thiếu permission → 403; 2-tenant KHÔNG thấy log công ty khác (withTenant+RLS); no-secret-log; FULL gate (security-reviewer — đọc dữ liệu security) + người chốt",
    ],
  },
  {
    id: "S2-HR-DB-1",
    module: "HR",
    layer: "DB",
    title:
      "Migration HR Core: departments·positions·job_levels·contract_types·employees·employee_status_histories·employee_code_configs + RLS+FORCE + indexes",
    zone: "red",
    // CLOSE (sync 2026-06-25): PR #21 merged 4e1791e (HR-Core mig 0442 idx125; FULL gate PASS×2).
    status: "done",
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**", "apps/api/test/integration/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "IMPLEMENTATION-05 §9.2 (HR-S2-001/002/003/005) §12.2/§12.4",
      "ISSUE-BOARD-01 §18.5 (HR-DB-001/002/003)",
      "DB-03",
      "SPEC-03",
    ],
    done_when: [
      "tạo bảng HR Core (company_id NOT NULL, UUID PK, soft delete, audit columns) khớp DB-03 §12.2; RLS ENABLE+FORCE + policy company_id TRƯỚC backfill; rls-registry đăng ký đủ (BẤT BIẾN #1)",
      "employee_status_histories (đổi status → history) + employee_code_configs (dùng sequence_counters, KHÔNG MAX+1); migration nối tiếp head 0441 — KHÔNG db:generate drop",
      "index company/status/department/full_name/code/joined_date (§12.4); migrate 0000→head sạch lane DB; cross-tenant deny xanh (rls-tenant-isolation-tester)",
    ],
  },
  {
    id: "S2-HR-SEED-1",
    module: "HR",
    layer: "DB",
    title:
      "Seed HR master data (job_levels·contract_types·employee_code_config + demo department/position) idempotent + seed HR permissions",
    zone: "red",
    status: "done",
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**", "apps/api/src/permission/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-DB-1", "S2-AUTH-SEED-1"],
    src: ["IMPLEMENTATION-05 §9.2 (HR-S2-004) §12", "ISSUE-BOARD-01 §18.5", "DB-03", "API-10"],
    done_when: [
      "seed job_levels/contract_types/employee_code_config ON CONFLICT DO NOTHING; chạy lại KHÔNG nhân đôi (idempotent từ DB trống + DB hiện có)",
      "seed HR permissions (HR.EMPLOYEE.VIEW/CREATE/UPDATE/CHANGE_STATUS · HR.DEPARTMENT.* · HR.POSITION.* · HR.MASTER_DATA.MANAGE · HR.EMPLOYEE_CODE.PREVIEW) + data_scope theo matrix §13",
      "permission sensitive (salary/contract) KHÔNG auto-grant qua wildcard; verify đếm đúng",
    ],
  },
  {
    id: "S2-HR-BE-1",
    module: "HR",
    layer: "BE",
    title:
      "HR read core: GET /hr/employees (list/pagination/search/filter/sort/data-scope) + GET /{id} (sensitive masking) + GET /hr/me/profile + lookups",
    zone: "red",
    // CLOSE (sync 2026-06-25): PR #30 merged 1c6aaef (scoped list + masked detail + me-profile + lookups).
    //   FULL gate PASS×2 (security/masking + TS-quality). LOW follow-ups (salaryType masking + quality) → S2-HR-MASK-1.
    status: "done",
    paths: [
      "apps/api/src/employees/**",
      "apps/api/src/org/**",
      "apps/api/src/positions/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-HR-DB-1", "S2-AUTH-BE-2"],
    src: [
      "IMPLEMENTATION-05 §9.3 (HR-S2-101/102/103/108) §11.3 §15.2",
      "ISSUE-BOARD-01 §18.5 (HR-BE-001/002)",
      "IMP02-STORY-025/026/032", // list-by-scope · detail+mask · own profile (/hr/me/profile)
      "API-03",
      "SPEC-03",
    ],
    done_when: [
      "GET /hr/employees qua guard data-scope (Own/Team/Department/Company/System) — list chỉ trả phạm vi đúng, pagination/search/filter/sort; KHÔNG lộ sensitive field nếu thiếu quyền (masking SERVER)",
      "GET /hr/employees/{id} field-level masking; GET /hr/me/profile chỉ hồ sơ liên kết user; lookups department/position/job-level/contract-type/employee-code preview",
      "deny-path RED viết-TRƯỚC: employee scope Own không thấy người khác; thiếu HR.EMPLOYEE.VIEW → 403; 2-tenant deny; response không chứa salary/bank khi thiếu quyền",
    ],
  },
  {
    id: "S2-HR-BE-2",
    module: "HR",
    layer: "BE",
    title:
      "HR write core: POST/PATCH /hr/employees + auto employee-code (tx + SequenceService) + change-status (history) + link/unlink user (unique active) + audit",
    zone: "red",
    // CLOSE (sync 2026-06-26): merged master #43 0b378eb (HR write core).
    status: "done",
    paths: ["apps/api/src/employees/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-1", "S2-HR-SEED-1"],
    src: [
      "IMPLEMENTATION-05 §9.3 (HR-S2-104/105/106/107) §11.3 §15.2 §16.2",
      "ISSUE-BOARD-01 §18.5 (HR-BE-003/004)",
      "IMP02-STORY-027/028", // create (auto-code, tx) · update + status history
      "API-03",
      "DB-03",
    ],
    done_when: [
      "POST /hr/employees sinh mã qua SequenceService trong tx (0-dup); validate duplicate email/code; ghi audit Created trong tx withTenant",
      "PATCH /hr/employees/{id} validate + audit old/new/changed_fields; change-status tạo employee_status_histories + optional lock user; link/unlink user enforce 1 user ↔ ≤1 employee active",
      "deny-path RED: thiếu quyền → 403 + 0 audit; soft-delete KHÔNG hard-delete (BẤT BIẾN #2); 2-tenant không ghi chéo; thao tác quan trọng có audit",
    ],
  },
  {
    id: "S2-HR-BE-3",
    module: "HR",
    layer: "BE",
    title:
      "Department/position CRUD (P1): create/update/soft-delete + master data manage (job-level/contract-type)",
    zone: "yellow",
    status: "done",
    paths: ["apps/api/src/org/**", "apps/api/src/positions/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-DB-1", "S2-AUTH-BE-2"],
    src: [
      "IMPLEMENTATION-05 §9.3 (HR-S2-109) §11.4",
      "ISSUE-BOARD-01 §18.5 (HR-BE-005)",
      "API-03",
      "IMP02-STORY-029/030",
    ],
    done_when: [
      "CRUD department (cây parent_id) + position có permission guard (HR.DEPARTMENT.*/HR.POSITION.*); soft-delete KHÔNG hard-delete",
      "validate cycle parent department + cùng company; audit thao tác create/update/delete",
      "deny-path: thiếu quyền → 403; 2-tenant deny; FE lookup load được dropdown",
    ],
  },
  {
    id: "S2-HR-BE-4",
    module: "HR",
    layer: "BE",
    title:
      "Profile change request skeleton (P1/P2): employee gửi yêu cầu sửa hồ sơ + HR duyệt/từ chối (có thể carry-over Sprint 5 nếu quá tải)",
    zone: "yellow",
    status: "done",
    paths: ["apps/api/src/employees/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-1"],
    src: [
      "IMPLEMENTATION-05 §9.3 (HR-S2-110) §11.4 (107)",
      "ISSUE-BOARD-01 §18.5",
      "API-03",
      "IMP02-STORY-033/034",
    ],
    done_when: [
      "POST profile-change-request (employee, scope Own) + GET list/detail; PATCH approve/reject (HR) ghi audit",
      "yêu cầu duyệt → áp vào employee có history; field nhạy cảm cần quyền cao hơn",
      "deny-path: employee chỉ gửi/sửa của mình; thiếu quyền duyệt → 403; carry-over policy ghi rõ nếu defer",
    ],
  },
  {
    id: "S2-FE-AUTH-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE Auth: Login page + auth bootstrap (/auth/me) + ProtectedRoute/PublicRoute/PermissionGate/ForbiddenState + menu/action visibility theo quyền",
    zone: "yellow",
    // CLOSE (sync 2026-06-25): PR #31 merged d6fbba3 (route guards wired + RHF login form). LIGHT gate PASS
    //   (react/TS). LOW findings = nhánh forward-compat unreachable (SHOW_LOADING/404) cố ý → KHÔNG cần WO.
    status: "done",
    paths: ["apps/auth/**", "apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-AUTH-BE-1", "S2-AUTH-BE-2"],
    src: [
      "IMPLEMENTATION-05 §9.4 (FE-S2-001..004) §14.1",
      "ISSUE-BOARD-01 §18.4",
      "IMP02-STORY-023", // route guard + app/menu/action/field visibility theo permission
      "FRONTEND-03",
      "FRONTEND-04",
      "UI-02",
    ],
    done_when: [
      "Login page form validation + call /auth/login, error state rõ; bootstrap session qua /auth/me, refresh giữ session nếu token hợp lệ",
      "ProtectedRoute/PublicRoute + PermissionGate/useCan (KHÔNG hard-code role); direct URL thiếu quyền → ForbiddenState (403); menu/action visibility theo permission",
      "token KHÔNG vào localStorage/sessionStorage + KHÔNG console.log (BẤT BIẾN #3 — grep chặn); loading/empty/error/forbidden; web test 3 app xanh",
    ],
  },
  {
    id: "S2-FE-HR-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE HR: EmployeeList (table/filter/search/pagination) + EmployeeDetail (tabs, masked sensitive state) nối API thật",
    zone: "green",
    // CLOSE (sync 2026-06-26): merged master wave2 #36 (FE HR list/detail).
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-HR-BE-1", "S2-FE-AUTH-1"],
    src: [
      "IMPLEMENTATION-05 §9.4 (FE-S2-005/006) §14.1 §14.3",
      "ISSUE-BOARD-01 §18.4",
      "FRONTEND-06",
      "UI-09",
    ],
    done_when: [
      "EmployeeList table + filter/search/pagination nối GET /hr/employees; loading/empty/error state",
      "EmployeeDetail tabs/sections hiển thị đúng quyền sensitive (field bị mask/ẩn do server — client không render được gì không nhận)",
      "web test list + detail xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-FE-HR-2",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE HR: EmployeeForm (create/edit) + dropdown lookups + validation + submit mutation + invalidate list/detail",
    zone: "green",
    // CLOSE (2026-06-26): EmployeeFormPage (create+edit) RHF + zodResolver; 4 dropdown lookups
    //   (department/position read; job-level/contract-type gated manage:master-data, query disabled
    //   when uncapable). hrApi.createEmployee/updateEmployee + create/update response schemas in
    //   contracts (match BE service returns). Edit PATCHes only dirty fields; empty-PATCH guarded.
    //   Pre-fill resets ONCE per employeeId (no refetch-clobber). Dirty-form guard wired; query
    //   invalidate list+detail on success. Routes /hr/employees/new + /$id/edit; list "Add" + detail
    //   "Edit" buttons (PermissionGate). i18n vi/form. app 124 test xanh, typecheck+lint 0 err
    //   (contracts/web-core rebuilt). LIGHT gate (medium code-review) — 2 correctness + 3 quality
    //   findings applied.
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-HR-BE-2", "S2-FE-HR-1"],
    src: [
      "IMPLEMENTATION-05 §9.4 (FE-S2-007) §14.3",
      "ISSUE-BOARD-01 §18.4",
      "FRONTEND-06",
      "UI-09",
    ],
    done_when: [
      "EmployeeForm React Hook Form + Zod validation; dropdown lookup department/position/job-level/contract-type",
      "submit mutation POST/PATCH; thành công → invalidate list/detail (TanStack Query); dirty-form guard",
      "web test form xanh; error/validation state hiển thị rõ",
    ],
  },
  {
    id: "S2-FE-HR-3",
    module: "FRONTEND",
    layer: "FE",
    title: "FE: MyProfile (read-only) + user/role read-only placeholder (P1, KHÔNG chặn Sprint 3)",
    zone: "green",
    // CLOSE (2026-06-25): MyProfile read-only (GET /hr/me/profile) + system/Users·Roles read-only pages
    //   + i18n vi/system + registry view:user/view:role (canonical seed §13). Rebased clean onto master
    //   (drop stale base; vitest/tsconfig giữ source-resolution). app 116 test + web-core 188 xanh, lint 0 err.
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-1", "S2-FE-AUTH-1"],
    src: ["IMPLEMENTATION-05 §9.4 (FE-S2-008/009) §14.2", "ISSUE-BOARD-01 §18.4", "FRONTEND-06"],
    done_when: [
      "MyProfile read-only nối GET /hr/me/profile — employee chỉ xem hồ sơ của mình",
      "user/role list placeholder hoặc read-only (không chặn Sprint 3 nếu chưa đủ)",
      "web test smoke xanh; loading/empty/error",
    ],
  },
  {
    id: "S2-INT-1",
    module: "BACKEND",
    layer: "INT",
    title:
      "Tích hợp HR tạo employee ↔ AUTH tạo/link user (giao dịch nhất quán, unique active link, audit cả 2 phía)",
    zone: "red",
    // CLOSE (sync 2026-06-26): merged master #45 5ab5dcb (HR↔AUTH provision; both /hr + legacy create routes gated).
    status: "done",
    paths: ["apps/api/src/employees/**", "apps/api/src/auth/**", "apps/api/src/users/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-2", "S2-AUTH-BE-3"],
    src: [
      "IMPLEMENTATION-05 §9 (IMP02-STORY-098)",
      "ISSUE-BOARD-01 §18 (EPIC-10)",
      "API-02",
      "API-03",
    ],
    done_when: [
      "tạo employee có thể tạo/link user tương ứng trong tx nhất quán; 1 user ↔ ≤1 employee active (unique)",
      "audit cả AUTH (user created) lẫn HR (employee created); rollback đồng bộ khi 1 phía lỗi",
      "deny-path RED: thiếu quyền 1 trong 2 → 403 + 0 ghi; 2-tenant không link chéo company",
    ],
  },
  {
    id: "S2-INT-2",
    module: "BACKEND",
    layer: "INT",
    title:
      "Tích hợp HR direct_manager ↔ data-scope Team/Department của permission resolver (approval scope nền cho LEAVE/ATT sau)",
    zone: "yellow",
    // CLOSE (sync 2026-06-26): merged master #46 1bb8f7d (manager-tree Team/Dept scope; base for LEAVE/ATT approval).
    status: "done",
    paths: ["apps/api/src/employees/**", "apps/api/src/permission/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-1", "S2-AUTH-BE-2"],
    src: [
      "IMPLEMENTATION-05 §9 (IMP02-STORY-099) §13",
      "ISSUE-BOARD-01 §18 (EPIC-10)",
      "BACKEND-03",
    ],
    done_when: [
      "scope resolver Team/Department đọc cây direct_manager/department từ HR — manager thấy nhân viên dưới quyền",
      "thay đổi direct_manager phản ánh đúng scope (KHÔNG cache cũ); base cho approval scope Sprint sau",
      "deny-path RED: manager không thấy ngoài cây mình; cross-tenant deny",
    ],
  },
  {
    id: "S2-QA-1",
    module: "QA",
    layer: "QA",
    title:
      "QA AUTH + RBAC/data-scope: login success/fail/locked/logout/me + Own/Team/Department/Company/System cho HR list/detail",
    zone: "red",
    // FIX-A (389688d) — SCOPE-WIRING ARTIFACT RESOLVED: it.fails cho Own/Team/Department trong
    //   employees-rbac-scope.int-spec.ts là artifact của endpoint SAI (/employees = EmployeesService
    //   .listEmployees, KHÔNG có scope wiring), KHÔNG phải gap backend thật. Sau FIX-A, spec được
    //   retarget sang /hr/employees (HrReadService, S2-HR-BE-1) — endpoint THẬT áp resolveAndAssert +
    //   buildEmployeeScopeCondition. Own/Team/Department nay là plain it() và xanh thật.
    //   KHÔNG cần follow-up WO backend wiring — /hr/employees ĐÃ áp DataScopeService đầy đủ.
    //
    // FIX-B (ea682be) + FIX-C (bc757f1) — CONFIG-GATE DELIBERATE, ĐÃ QUA FULL GATE:
    //   apps/api/vitest.config.ts (thêm per-file >=80% stmts+branch cho auth.service.ts,
    //   permission.service.ts, data-scope.service.ts) + apps/api/package.json (test:cov:sensitive:
    //   --no-file-parallelism + --coverage.clean=true, bỏ --pool=forks crash) là thay đổi
    //   ngưỡng coverage CÓ CHỦ ĐÍCH, đã qua FULL red-zone review (security-reviewer + santa-method).
    //   guard-scope/scope-creep finding = RESOLVED: đây là gate acceptance thêm vào, KHÔNG phải
    //   drift tình cờ. Gatekeeper đã approve merge 2 file config này kèm FIX-B/FIX-C.
    //   Kết quả đo thật (LANE_DB=mediaos_s2qa1fixc): auth.service.ts 92.29%/83.33%,
    //   permission.service.ts 96.02%/91.87%, data-scope.service.ts 98.83%/88.88%,
    //   All files 93.62%/87.6% — tất cả >=80% stmts+branch.
    // CLOSE (sync 2026-06-26): merged master wave2 #36 (QA AUTH+RBAC/data-scope).
    status: "done",
    paths: [
      "apps/api/src/auth/**/*.spec.ts",
      "apps/api/src/permission/**/*.spec.ts",
      "apps/api/test/**",
      "harness/backlog.mjs",
    ],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-BE-2", "S2-HR-BE-1"],
    src: [
      "IMPLEMENTATION-05 §9.5 (QA-S2-001/002/004) §17.1",
      "ISSUE-BOARD-01 §18.5",
      "QA-03",
      "CLAUDE.md §6",
    ],
    done_when: [
      "auth test: login success/sai mật khẩu/locked/inactive/logout/me — error chuẩn, login_log đúng, no-secret-log",
      "RBAC/data-scope: Own/Team/Department/Company/System cho HR list+detail trên DB cô lập lane; deny-path 403; cross-tenant deny",
      "sensitive-data: thiếu quyền KHÔNG thấy field nhạy cảm (salary/bank); coverage vùng nhạy cảm ≥80%",
    ],
  },
  {
    id: "S2-QA-2",
    module: "QA",
    layer: "QA",
    title:
      "QA HR CRUD + FE smoke + regression: employee create/update/status/link-user + login/route-guard/list/detail/create + checklist Sprint 2",
    zone: "red",
    // CLOSE (sync 2026-06-26): merged master #48 63ac8bf (HR CRUD coverage + FE smoke + Sprint 2 regression sign-off).
    status: "done",
    paths: ["apps/api/src/employees/**/*.spec.ts", "apps/api/test/**", "apps/app/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-2", "S2-FE-HR-2"],
    src: [
      "IMPLEMENTATION-05 §9.5 (QA-S2-003/005/006) §17.2/§17.3 §18",
      "ISSUE-BOARD-01 §18.5",
      "QA-03",
      "QA-06",
    ],
    done_when: [
      "HR API: employee create (mã tự sinh 0-dup)/update/change-status (history)/link-user (unique active) trên DB cô lập lane",
      "FE smoke: login → route guard → HR list → detail → create employee (theo §17.3); state loading/empty/error",
      "regression checklist Sprint 2 (§18 acceptance) ký xác nhận; `pnpm --filter @mediaos/api test` xanh phạm vi THẬT",
    ],
  },

  // ════════════════════ FOLLOW-UP — review LOW findings từ PR #28-#31 (merged 2026-06-25) ════════════════════
  // 7 reviewer agent (security/db/silent-failure/ts/react) PASS×4 PR, KHÔNG CRITICAL/HIGH. Các LOW dưới đây
  // KHÔNG chặn merge → gộp thành WO follow-up có chủ thay vì để trôi. FE #31 LOW = forward-compat cố ý → KHÔNG WO.
  {
    id: "S2-QA-DEBT-1",
    module: "QA",
    layer: "QA",
    title:
      "Test-hygiene AUTH: gate int-spec trên hasDb && LANE_DB (KHÔNG bare skipIf(!hasDb)) + siết efficacy forgot-password-rate-limit spec",
    zone: "yellow",
    // FOLLOW-UP review PR #28/#29. Test-only — KHÔNG đụng logic service. LIGHT gate.
    // CLOSE (sync 2026-06-26): merged master #40 bc73304 (LANE_DB gate + forgot-pw rate-limit efficacy).
    status: "done",
    paths: [
      "apps/api/test/integration/auth-users-admin.int-spec.ts",
      "apps/api/test/integration/auth-roles-permissions.int-spec.ts",
      "apps/api/src/auth/forgot-password-rate-limit.spec.ts",
    ],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-BE-3", "S2-AUTH-BE-4"],
    src: [
      "review PR #28/#29 (LOW: LANE_DB gate + rate-limit spec efficacy)",
      "CLAUDE.md §9.5 (lane DB cô lập)",
      "harness memory: Integration test LANE_DB gate",
    ],
    done_when: [
      "auth-users-admin.int-spec.ts + auth-roles-permissions.int-spec.ts đổi describe.skipIf(!hasDb) → skipIf(!(hasDb && LANE_DB)) khớp tiền lệ auth-appendonly/data-scope-resolver (tránh đỏ-giả / ô nhiễm DB dev chung)",
      "forgot-password-rate-limit.spec: THÊM assert (a) N lần forgotPassword THẬT đẩy bucket tới locked; (b) khi locked, withTenant/DB KHÔNG được gọi (short-circuit) — KHÔNG chỉ test 'void khi đã pre-lock'",
      "pnpm --filter @mediaos/api test xanh trên lane DB cô lập; spec mới thực sự xuất hiện trong run summary (KHÔNG xanh-giả)",
    ],
  },
  {
    id: "S2-AUTH-HARDEN-1",
    module: "AUTH",
    layer: "BE",
    title:
      "Hardening password-reset (P2): tách rate-limit bucket forgot khỏi login + giảm timing-oracle enumeration + redact token ở mail-catch + .env.example RESET_PASSWORD_URL",
    zone: "red",
    // FOLLOW-UP review PR #29 — các LOW security của forgot/reset-password (KHÔNG chặn merge). Auth crown → FULL gate.
    // CLOSE (sync 2026-06-26): merged master #42 18f5665 (separate forgot rate-limit namespace + uniform-response floor).
    status: "done",
    paths: [
      "apps/api/src/auth/auth.service.ts",
      "apps/api/src/auth/reset-password-mail.service.ts",
      "apps/api/src/auth/login-rate-limiter.ts",
      ".env.example",
    ],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-BE-4"],
    src: [
      "review PR #29 (LOW: rate-limit bucket share / timing-oracle / token-redact / env.example)",
      "SPEC-02",
      "API-02",
    ],
    done_when: [
      "forgot-password dùng namespace rate-limit RIÊNG (rl:forgot:*) — KHÔNG chung bucket login (rl:acct/rl:ip) → spam forgot KHÔNG lock được login của victim; sửa comment sai 'reset sau resetPassword'",
      "giảm timing-oracle: đẩy gửi mail HẲN khỏi request-path (dựa outbox consumer đã có) HOẶC thêm sàn/jitter để nhánh email-tồn-tại ≈ nhánh ghost (giữ uniform 202)",
      "reset-password-mail.service KHÔNG rethrow kèm token ra caller (mirror InviteMailService trả {sent:false,reason}) HOẶC redact token ở catch — chuẩn bị SMTP thật (BẤT BIẾN #3); .env.example thêm RESET_PASSWORD_URL= (empty default)",
      "deny-path RED giữ nguyên (uniform 202, no-enum, no-secret-log); FULL gate (auth crown) + người chốt",
    ],
  },
  {
    id: "S2-HR-MASK-1",
    module: "HR",
    layer: "BE",
    title:
      "HR read tinh chỉnh (P2): xác nhận+gate masking salaryType theo SPEC-03 §18.8 + dọn quality (audit N+1 list / email .email() / hằng code-length)",
    zone: "red",
    // FOLLOW-UP review PR #30. salaryType = quyết định masking field nhạy cảm → red/FULL (fail-closed); phần quality là nhẹ.
    //   CLOSE (2026-06-26, branch feat/s2-hr-mask-1):
    //   • CHỐT owner: salaryType = salary-class (§18.8 "dữ liệu lương") → gate cùng baseSalary sau view-salary (fail-closed).
    //   • N+1 list-path: GIỮ per-row reveal — can('view-salary') có resourceId honor object-grant (ADR-0010), trang trộn
    //     reveal/mask; gộp resourceType-level = rò lương chéo-bản-ghi. KHÔNG hạ. (plan-block 25/6 đã cảnh báo đúng.)
    //   • quality: email output .email() · DEFAULT_EMPLOYEE_CODE_NUMBER_LENGTH=4 · comment getMyProfile guard.
    //   • FULL gate security-reviewer: diff in-scope PASS; phát hiện CRITICAL CÓ SẴN ngoài scope (legacy GET /employees
    //     rò salaryType+PII+IDOR, console dùng) → owner chốt tách → S2-HR-EMP-LEGACY-LOCK-1. Verify: 15 unit + 36 int xanh (LANE_DB).
    //   CLOSE (sync 2026-06-26): merged master #49 6c66ab5 (salaryType gated behind view-salary, fail-closed).
    status: "done",
    paths: [
      "apps/api/src/employees/hr-read.service.ts",
      "apps/api/src/employees/hr-read.repository.ts",
      "packages/contracts/src/hr/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-1"],
    src: [
      "review PR #30 (LOW: salaryType unmasked / per-row audit N+1 / email format / magic number)",
      "SPEC-03 §18.8 (dữ liệu lương nhạy cảm)",
      "API-03",
    ],
    done_when: [
      "CHỐT với SPEC-03 §18.8: salaryType (monthly/hourly/project) có thuộc 'dữ liệu lương nhạy cảm' không — CÓ → gate sau revealSalary cùng baseSalary; KHÔNG → ghi note spec là directory-data cố ý hở",
      "(tùy chọn) list-path resolve view-salary 1 lần/trang + 1 audit list-view thay vì can()+audit per-row (bỏ N+1 trong tx) — GIỮ bất biến reveal⟹audit",
      "quality: contracts output email dùng z.string().email(); hằng DEFAULT_EMPLOYEE_CODE_NUMBER_LENGTH=4 thay magic number; comment getMyProfile rõ guard là gate",
      "masking đụng field nhạy cảm → FULL gate (security-reviewer) + người chốt; regression deny-path HR còn xanh",
    ],
  },
  {
    id: "S2-HR-EMP-LEGACY-LOCK-1",
    module: "HR",
    layer: "BE",
    title:
      "Khoá route legacy GET /employees(/:id): mask salaryType+PII (view-salary/view-sensitive) + data-scope (vá IDOR nội-tenant) hoặc di trú console→/hr/employees",
    zone: "red",
    // FOLLOW-UP từ FULL gate S2-HR-MASK-1 (2026-06-26). CRITICAL CÓ SẴN (không do MASK-1 tạo): EmployeesController
    // (media-era, vẫn mount app.module.ts:50) phục vụ console qua employees-api.ts. EmployeesService.getEmployee/
    // listEmployees chỉ mask baseSalary → salaryType+phone+contractType+notes lọt cho mọi caller có read:employee mà
    // KHÔNG cần view-salary/view-sensitive; thêm THIẾU data-scope → IDOR đọc bất kỳ nhân viên nội-tenant. hr-read đã kín;
    // route legacy là bề mặt còn hở. crown/FULL gate. CHỐT hướng: (a) mask+scope route legacy, HOẶC (b) di trú console
    // sang /hr/employees rồi decommission route đọc legacy. KHÔNG xoá code media-era nếu chỉ disable route đủ.
    // CLOSE (sync 2026-06-26): merged master #50 49ef4dc (scope + mask legacy GET /employees(/:id); IDOR + leak closed).
    status: "done",
    paths: [
      "apps/api/src/employees/employees.service.ts",
      "apps/api/src/employees/employees.controller.ts",
      "apps/api/src/employees/employees.repository.ts",
      "apps/api/test/**",
      "apps/console/src/lib/employees-api.ts",
    ],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-1", "S2-HR-MASK-1"],
    src: [
      "FULL gate S2-HR-MASK-1 (CRITICAL: legacy /employees rò salaryType+PII + IDOR thiếu data-scope)",
      "SPEC-03 §18.8 (dữ liệu lương nhạy cảm)",
      "S2-INT-1 note (TWO routes: /hr/employees + legacy /employees)",
    ],
    done_when: [
      "GET /employees/:id + GET /employees: salaryType gate view-salary (reveal⟹audit) + phone/contractType/notes gate view-sensitive — KHÔNG còn lọt khi thiếu quyền (mirror hr-read masking layer)",
      "data-scope: áp resolveAndAssert + isEmployeeInScope (Own/Team/Department/Company/System) cho list+detail legacy → vá IDOR nội-tenant; cross-tenant + out-of-scope → 404",
      "HOẶC: di trú apps/console/src/lib/employees-api.ts sang /hr/employees rồi decommission route đọc legacy (giữ create/import nếu còn dùng) — chốt hướng với owner",
      "deny-path RED viết-TRƯỚC; FULL gate (security-reviewer) PASS + người chốt; regression console + HR còn xanh",
    ],
  },
  {
    id: "S2-AUTH-BRAND-1",
    module: "AUTH",
    layer: "BE",
    title:
      "Rebrand TOTP issuer (P3): TOTP_ISSUER 'MediaOS' → 'FUNTIME MEDIA' khớp rebrand FE (#37), GIỮ tương thích 2FA đã enroll",
    zone: "red",
    // FOLLOW-UP rebrand PR #37. TOTP_ISSUER là nhãn hiện trong app authenticator (Google/Authy) → đụng auth/token =
    //   crown-jewel (FULL gate). Validation dựa trên SECRET nên user đã bật 2FA KHÔNG bị khoá; chỉ nhãn hiển thị đổi.
    // CLOSE (sync 2026-06-26): merged master #41 9db83d6 (TOTP issuer MediaOS → FUNTIME MEDIA, backward-compat).
    status: "done",
    paths: [
      "apps/api/src/auth/totp.service.ts",
      "apps/api/src/auth/totp.service.spec.ts",
      "apps/console/src/components/two-factor/TwoFactorSettings.spec.tsx",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "rebrand PR #37 (EMS/MediaOS → FUNTIME MEDIA): topbar/AuthLayout/home/index.html đã đổi, còn TOTP_ISSUER",
      "SPEC-02 (2FA/TOTP)",
      "apps/api/src/auth/totp.service.ts §TOTP_ISSUER",
    ],
    done_when: [
      "TOTP_ISSUER 'MediaOS' → 'FUNTIME MEDIA' trong totp.service.ts; cập nhật totp.service.spec.ts (assert issuer mới) + console TwoFactorSettings.spec.tsx (otpauth fixture); otpauth:// URI-encode đúng dấu cách trong issuer",
      "XÁC NHẬN tương thích ngược: secret KHÔNG đổi → user đã enroll vẫn verify/login được; chỉ nhãn authenticator đổi cho enrollment MỚI (cũ giữ 'MediaOS' tới khi tự re-enroll) — KHÔNG ép re-enroll, KHÔNG migration data",
      "GHI policy nhãn hỗn hợp (cũ MediaOS / mới FUNTIME MEDIA) là chấp nhận; cân nhắc 1 dòng note UI 2FA nếu cần",
      "FULL gate (security-reviewer — auth crown) + người chốt; regression 2FA enroll/verify/login còn xanh; deny-path không đổi",
    ],
  },

  // ════════════════════ CARRY-OVER — EPIC-03 HR P1/P2 (deferred khỏi Sprint 2) ════════════════════
  // Quyết 2026-06-26 (owner): 4 story HR còn lại KHÔNG seed WO sống đợt này (giữ Sprint 3 = ATT/LEAVE tập trung —
  //   241pt đã nặng nhất MVP). Là gap THẬT (chưa build), KHÔNG phải lỗi trace — dashboard /progress hiển thị đúng
  //   'planned'. PULL như 1 mini-pass "HR-finish" SAU khi Sprint 3 P0 spine (ATT/LEAVE core) xanh, HOẶC fold vào
  //   Sprint 5 hardening. Khi pull → dịch story → WO (paths/done_when/depends_on/src) như quy ước master-plan §3.
  //     • IMP02-STORY-031 (P1) quản lý hợp đồng lao động — CẦN bảng employee_contracts MỚI (migration) + CRUD +
  //       file hợp đồng + cảnh báo hết hạn. Lớn nhất (đụng DB). KHÔNG có ticket ISSUE-BOARD §18.5.
  //     • IMP02-STORY-035 (P1) cấu hình quy tắc mã NV (admin) + preview — preview ĐÃ xong (SequenceService +
  //       S2-HR-BE-1 lookup employee-code); còn THIẾU endpoint admin sửa employee_code_configs (bảng có ở S2-HR-DB-1)
  //       + lock manual-edit + FE config. ~Nửa-xong.
  //     • IMP02-STORY-036 (P1) upload/quản lý file hồ sơ NV — FileService/FilePolicy ĐÃ có (S1-FND-FILE-1); còn THIẾU
  //       đăng ký FilePolicy entity ('employee') + HR upload/list/download/delete UI + file_access_log. KHÔNG có ticket §18.5.
  //     • IMP02-STORY-037 (P2) org chart cơ bản — đọc cây department/direct_manager (data ĐÃ có qua S2-INT-2 manager-tree)
  //       + FE tree theo scope (không lộ người ngoài quyền). Thấp nhất. KHÔNG có ticket §18.5.

  // ════════════════════ SPRINT 3 — Attendance Core + Leave Core + LEAVE→ATT Sync ════════════════════
  // IMPLEMENTATION-06 · EPIC-04 ATT (111pt) + EPIC-05 LEAVE (117pt) + EPIC-10 sync story-100/064 (13pt) = 241pt.
  // PULL 2026-06-26: Sprint 2 (AUTH+HR core) đã HỘI TỤ — toàn bộ S2 WO merged master (#28..#50, follow-up #38/#40/#41/#42;
  //   effective=done qua ledger). → kéo sprint kế theo quy ước "chỉ giữ sprint hành" (master-plan §3). Nguồn phân rã =
  //   IMPLEMENTATION-06 §8 (epic→story) · §10 (API checklist) · §11 (permission seed + data_scope canonical) · §12 (data
  //   seed) · §13 (test plan) · §22 (story point) + ISSUE-BOARD-01 §18.6 (ATT) / §18.7 (LEAVE). Kỹ thuật module: DB-04/05 ·
  //   API-04/05 · SPEC-04/05 · UI-03/04 (tra docs/README.md).
  //
  // ⚠️ CAPACITY (IMPLEMENTATION-06 §22.4 — BẮT BUỘC quyết trước khi commit): 241pt là tải NẶNG NHẤT toàn MVP (~3-5×
  //   velocity 1 sprint). Quyết định vận hành (khớp harness v2 "1 WO/phiên, tuần tự"): KHÔNG ép 2 tuần — chạy P0-spine
  //   TRƯỚC theo dependency, P1 (yellow) sau, P2 = CARRY-OVER (KHÔNG seed đợt này). Cutline §17 + carry-over §21 áp dụng.
  //
  // KHÔNG seed đợt này (carry-over §21 → Sprint 4 hoặc khi P0 spine xanh): adjustment workflow đầy đủ (CO-S4-003) ·
  //   remote-work workflow (CO-S4-004) · leave calendar (CO-S4-005, LEAVE-FE-004=Sprint 4) · export ATT/LEAVE (CO-S4-006) ·
  //   shift/rule + leave-policy admin UI nâng cao (CO-S4-007/008) · hourly-leave nếu giảm scope. Bảng adjustment/remote-work
  //   VẪN migrate ở S3-ATT-DB-1 (đủ schema) nhưng API/UI để Sprint sau.
  //
  // RECONCILE-FIRST: code media-era đã có apps/api/src/attendance/** + apps/api/src/leave/** (logic/controller/repo/dto/spec)
  //   → đối chiếu DB-04/05·API-04/05·SPEC-04/05, GIỮ phần khớp, build/sửa phần lệch. SPEC THẮNG khi mâu thuẫn. Bảng ATT/LEAVE
  //   chuẩn-spec có thể CHƯA tồn tại trong db/schema (không có attendance.ts/leave.ts) → S3-*-DB-1 dựng theo DB-04/05.
  //   Thứ tự dependency (IMPLEMENTATION-01 §4): ATT-DB → LEAVE-DB → SEED → ATT-BE → LEAVE-BE → SYNC → FE → QA.
  //   Crown/FULL gate cho mọi WO chạm permission·data_scope·audit·migration·workflow phê duyệt (CLAUDE.md §6) → người chốt.

  // ── DB (lane db-migration NỐI TIẾP — KHÔNG song song; head hiện idx 131 / 0451) ──
  {
    id: "S3-ATT-DB-1",
    module: "ATT",
    layer: "DB",
    title:
      "Migration ATT Core: shifts·shift_assignments·attendance_rules·attendance_records·attendance_logs (+adjustment·remote_work skeleton) + RLS+FORCE + indexes + append-only attendance_logs",
    zone: "red",
    // CLOSE (sync 2026-06-26): merged to master via PR #54 (squash 07254e3) — migration 0452 ATT Core
    //   (DB-04 reconcile, evolve-additive). FULL gate PASS×3. Literal reconciled todo→done so auto-loop skips it.
    status: "done",
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**", "apps/api/test/integration/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "IMPLEMENTATION-06 §7.3 §12.1 (ATT tables/seed)",
      "ISSUE-BOARD-01 §18.6 (ATT-DB-001/002/003)",
      "DB-04",
      "SPEC-04",
    ],
    done_when: [
      "tạo bảng ATT (shifts·shift_assignments·attendance_rules·attendance_records·attendance_logs + adjustment·remote_work skeleton) khớp DB-04: company_id NOT NULL · UUID PK · soft-delete · audit columns; RLS ENABLE+FORCE + policy company_id TRƯỚC backfill; rls-registry đăng ký đủ (BẤT BIẾN #1)",
      "attendance_records UNIQUE (company_id, employee_id, work_date[, shift_id]) chống trùng khi check-in nhiều lần; lưu applied_rule snapshot (rule đổi KHÔNG sai dữ liệu cũ — §16); index company/employee/work_date/status (§7.3)",
      "attendance_logs append-only (app role REVOKE UPDATE/DELETE) — RED test ghi-rồi-update FAIL (BẤT BIẾN #2); migration NỐI TIẾP head 0451 (KHÔNG db:generate drop); 1 lane db-migration",
      "migrate 0000→head sạch lane DB cô lập; cross-tenant deny xanh (rls-tenant-isolation-tester)",
    ],
  },
  {
    id: "S3-LEAVE-DB-1",
    module: "LEAVE",
    layer: "DB",
    title:
      "Migration LEAVE Core: leave_types·leave_policies·leave_balances·leave_balance_transactions·leave_requests·leave_request_days·leave_request_approvals + RLS+FORCE + indexes + append-only ledger",
    zone: "red",
    // CLOSE (deploy-gate 2026-06-26): landed on feat/s3-wave1 (commit 0b04f12) — migration 0453 LEAVE Core
    //   (DB-05 evolve-additive, 4 new tables + ALTER-ADD, RLS+FORCE, append-only ledger). FULL gate PASS.
    status: "done",
    paths: ["apps/api/src/db/schema/**", "apps/api/migrations/**", "apps/api/test/integration/**"],
    skills: ["code-review"],
    depends_on: ["S3-ATT-DB-1"], // ordering: lane db-migration NỐI TIẾP (idx kế ATT-DB), KHÔNG data-dep thực
    src: [
      "IMPLEMENTATION-06 §7.3 §12.2 (LEAVE tables/seed)",
      "ISSUE-BOARD-01 §18.7 (LEAVE-DB-001/002)",
      "DB-05",
      "SPEC-05",
    ],
    // RECONCILE (chốt owner 2026-06-26 = follow landed schema, MIRROR Option A của 0452; defer DB-05 balance semantics → S3-LEAVE-BE).
    done_when: [
      "RECONCILE (mirror Option A 0452): 3 bảng media-era đã tồn tại (leave_types·leave_requests·leave_balances ở hr.ts/mig 0062) → EVOLVE-ADDITIVE (thêm cột DB-05 dạng ADD COLUMN IF NOT EXISTS <type> NULL — KHÔNG NOT NULL, KHÔNG DEFAULT-rewrite, an toàn trên hàng cũ); used_days/remaining_days ĐÃ có → KHÔNG re-add. CREATE 4 bảng MỚI (leave_policies·leave_balance_transactions·leave_request_days·leave_request_approvals) company_id NOT NULL·UUID PK·soft-delete + RLS ENABLE+FORCE + policy company_id TRƯỚC backfill (BẤT BIẾN #1)",
      "GIỮ NGUYÊN media-era leave_balances.remaining_days GENERATED ALWAYS AS (total_days-used_days) STORED + CHECK used<=total (CẤM DROP/recreate cột generated); ngữ nghĩa remaining_days/negative-balance theo DB-05 = SCOPED OUT sang S3-LEAVE-BE (KHÔNG làm ở DB lane này)",
      "status CHECK: DROP CONSTRAINT leave_req_status_check (mig 0062 chỉ cho lowercase) RỒI ADD lại 1 union check (lowercase ∪ TitleCase Draft/Pending/Approved/Rejected/Cancelled/Revoked theo SPEC-05) — KHÔNG 'thêm union song song' (residual cũ sẽ reject TitleCase); leave_request_days có attendance_sync_status (§8.7); index company/employee/status/date-range",
      "rls-registry: leave_types/leave_requests/leave_balances ĐÃ đăng ký (~lines 1358-1399) — chỉ THÊM 4 bảng MỚI (KHÔNG tạo case trùng); leave_balance_transactions·leave_request_approvals append-only (app role REVOKE UPDATE/DELETE — BẤT BIẾN #2) → registry seed = direct/superuser (FK chain cũng direct) để append-only check không fail; migration NỐI TIẾP head ATT-DB (KHÔNG db:generate drop), 1 lane db-migration",
      "POSITIVE test: app-role INSERT leave_requests status='Pending' (TitleCase) + cột DB-05 mới THÀNH CÔNG dưới RLS (chứng minh union + cột mới chạy thật, không xanh-giả trên DB rỗng); migrate 0000→head sạch lane DB; cross-tenant deny xanh (rls-tenant-isolation-tester)",
    ],
  },

  // ── FOUNDATION: runtime per-company master-data seed runner (chốt owner ① 2026-06-27) ──
  // Lý do: master-data theo công ty (ca/rule ATT · leave-type/policy LEAVE · HR master-data) KHÔNG seed được lúc
  //   migrate-time (DB sạch 0 company → FK/NOT-NULL fail; convention mig 0445/0008 cấm). SeedTrackingService ĐÃ có
  //   nhưng CHƯA có ai gọi/trigger → master-data không bao giờ chạy. WO này dựng cơ chế đó, dùng chung mọi module.
  {
    id: "S3-FND-SEEDRUN-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Runtime per-company master-data seed runner: registry + bootstrap reconcile chạy mỗi company qua SeedTrackingService + withTenant (idempotent), nền cho ATT/LEAVE/HR master-data seed",
    zone: "red",
    // CLOSE 2026-06-27: committed aa0a3b3 trên feat/s3-wave1 (hand-built). FULL gate PASS — security-reviewer PASS
    //   (0 CRIT/HIGH; tenant/append-only/secret/authz ✓; enumerate qua withPlatformContext mig 0230), completion 93/100.
    //   Verified trên Postgres lane cô lập: unit 10/10 + int 4/4 (idempotent + fail-safe + RLS app-role). API seeder cho ATT/LEAVE cắm vào.
    //   Follow-up (KHÔNG chặn, để wave PR): +cross-tenant WITH CHECK deny test · unit test bootstrap gating · gỡ dead export MASTER_DATA_SEEDERS symbol.
    status: "done",
    paths: ["apps/api/src/foundation/**", "apps/api/test/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "S3-ATT-SEED-1 round-3/4 plan-review (no runtime seeder exists — memory s3-spine-planblock-schema-divergence)",
      "mig 0445/0008 (convention: company-scoped master-data = RUNTIME seed, KHÔNG migrate-time)",
      "SeedTrackingService (apps/api/src/foundation/seed/seed-tracking.service.ts: startBatch/markItem/finishBatch)",
    ],
    done_when: [
      "MasterDataSeederRegistry + interface ModuleMasterDataSeeder {seedKey, seedVersion, seed(ctx:{companyId,tx,track})} — module ATT/LEAVE/HR đăng ký seeder của mình; runner KHÔNG biết chi tiết module (đảo phụ thuộc)",
      "Bootstrap reconcile (OnApplicationBootstrap HOẶC startup service, có cờ env tắt cho test/CI): với MỖI company chưa xoá → chạy MỌI seeder đã đăng ký idempotent qua SeedTrackingService.startBatch(companyId,seedKey,version) → markItem từng row → finishBatch, TẤT CẢ trong withTenant(companyId) (RLS WITH CHECK pass; company_id từ context, BẤT BIẾN #1). Chạy được cho N=1 + sẵn sàng N>1 (loop mọi company)",
      "FAIL-SAFE: 1 seeder lỗi → log có cấu trúc + markBatch Failed, KHÔNG crash app boot, KHÔNG chặn seeder khác; idempotent: chạy lại = markItem Skipped (checksum) + ON CONFLICT no-op (KHÔNG nhân đôi)",
      "integration test LANE_DB: tạo company test → gọi ĐÚNG entry-point runner production dùng → assert seeder chạy (rows tồn tại) + chạy lần 2 = Skipped (idempotent). Dùng app role RLS-enforced (KHÔNG owner/migrator bypass). KHÔNG migration mới (tái dùng seed_batches/seed_items)",
    ],
  },

  // ── SEED (permission + data_scope theo §11 + business default §12) ──
  {
    id: "S3-ATT-SEED-1",
    module: "ATT",
    layer: "DB",
    title:
      "Seed ATT permissions (§11.1) + role→data_scope mapping (§11.3) + default shift OFFICE_8H + DEFAULT_OFFICE_RULE (§12.1) idempotent",
    zone: "red",
    // DONE 2026-06-27 (feat/s3-wave1, b8026313 + canonical fix 7b02f72): mig 0454 = 33 cặp catalog + 93 grant per-pair (least-privilege ① manager-deny COUNT=0 + 8 deny test) · attendance-permissions.const.ts (PIN cho S3-ATT-BE-1) · AttMasterDataSeeder (OFFICE_8H 08:00-17:00/60' + DEFAULT_OFFICE_RULE) cắm vào runner S3-FND-SEEDRUN-1 · 170 int-spec PASS lane mediaos_attseed (reset→0454 clean) · FULL gate PASS (security PASS, completion 89/100 PASS; MEDIUM CA view-team Company→Team đã reconcile về API-10 §5.3). Verify cuối + merge ở wave-PR feat/s3-wave1→master.
    status: "done",
    paths: [
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "apps/api/src/permission/**",
      "apps/api/src/foundation/**",
    ],
    skills: ["code-review"],
    depends_on: ["S3-ATT-DB-1", "S2-AUTH-SEED-1", "S3-FND-SEEDRUN-1"],
    src: [
      "IMPLEMENTATION-06 §11.0/§11.1 (catalog + data_scope canonical)",
      "SPEC-04 §12 + DB-04 §12 + API-10 §5.3 (ma trận role→action→data_scope — NGUỒN CHUẨN, KHÔNG '§11.3')",
      "DB-10 §14.2 (Initial-Seed-Data design-of-record: OFFICE_8H 08:00-17:00/60' + DEFAULT_OFFICE_RULE)",
      "mig 0444/0445 (per-pair seed pattern) · mig 0005 (audit-log generic — KHÔNG tái dùng) · mig 0452 (landed ATT schema)",
    ],
    // RECONCILE v3 (chốt owner 2026-06-27, sau 3 lần plan-block — TÁCH 2 phần: (A) PERMISSION = migration; (B) MASTER-DATA ca/rule = RUNTIME seeder cắm vào S3-FND-SEEDRUN-1):
    //   roles FLAT (mig 0444) · least-privilege ① (manager KHÔNG shift/rule-view) · catalog §11.2 = 33 mã · default ca/rule = DB-10 §14.2 · KHÔNG seed master-data lúc migrate.
    done_when: [
      "(A) PERMISSION = migration 0454 NỐI TIẾP head (global/system-scoped, AN TOÀN migrate-time — KHÔNG đụng bảng company-scoped): (a) catalog §11.2 = ĐÚNG 33 cặp (action,resource_type) TƯỜNG MINH — ATTENDANCE.{CHECK_IN,CHECK_OUT,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,VIEW_DETAIL,VIEW_SENSITIVE,ADJUST_DIRECT,RECALCULATE,EXPORT} · ADJUSTMENT.{CREATE_OWN,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,APPROVE,REJECT,CANCEL_OWN} · REMOTE_REQUEST.{CREATE_OWN,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,APPROVE,REJECT,CANCEL_OWN} · SHIFT.{VIEW,CREATE,UPDATE,DELETE} · SHIFT_ASSIGNMENT.{VIEW,UPDATE} · RULE.{VIEW,CONFIG} · AUDIT_LOG.VIEW(=cặp riêng 'view','attendance-audit-log'); ON CONFLICT(action,resource_type) DO NOTHING; assert TỒN TẠI theo từng cặp (KHÔNG count===34); is_sensitive=true cho quyền DB-04 §12 đánh Sensitive; PIN cặp vào 1 hằng dùng chung S3-ATT-BE-1",
      "(A) ROLE→data_scope BẢNG TƯỜNG MINH per-(role,action,resource) theo API-10 §6.3 — roles FLAT (KHÔNG kế thừa): check_in/check_out/view_own + *_OWN(adjustment,remote) = Own cho TẤT CẢ role (emp+mgr+hr+CA); view_team/*_VIEW_TEAM/APPROVE/REJECT = mgr+hr+CA (Team); view_company/VIEW_SENSITIVE/RECALCULATE/ADJUST_DIRECT/EXPORT/*_VIEW_COMPANY = hr+CA (Company); view_detail = Own(emp)+Team(mgr)+Company(hr/CA) (SPEC-04 §12 THẮNG API-10); **LEAST-PRIVILEGE (owner ①): SHIFT.*/SHIFT_ASSIGNMENT.*/RULE.* + AUDIT_LOG.VIEW = CHỈ hr+CA (Company) — manager (✓)=grantable-not-default → KHÔNG seed**; super-admin runtime (KHÔNG seed system company_id NULL). Pattern mig 0444: per-cặp DELETE wrong-scope + INSERT ON CONFLICT(role_id,permission_id,effect), CẤM blanket DELETE; DO-block thuần KHÔNG db:generate",
      "(A) deny + positive test TỪNG role: emp/mgr/hr/CA đều có Own check-in/out/view-own; manager KHÔNG có shift.view/shift_assignment.view/rule.view/audit_log.view (deny — chống over-grant); emp KHÔNG có view_company/approve/reject; cross-tenant RLS deny dùng app role (mediaos_app, KHÔNG owner bypass); idempotent ĐO BỘ BA (role_id,permission_id,data_scope)",
      "(B) ATT MASTER-DATA SEEDER (RUNTIME — đăng ký vào MasterDataSeederRegistry của S3-FND-SEEDRUN-1, KHÔNG seed trong migration): seed OFFICE_8H (DB-10 §14.2: start 08:00·end 17:00·break_start 12:00·break_end 13:00 [=60']·required 480·is_default=true·tz→metadata jsonb) + DEFAULT_OFFICE_RULE (rule_code='DEFAULT_OFFICE_RULE'·rule_scope='Company'·effective_from set·grace 5/5 TRÊN SHIFT·rule_config jsonb {missing_checkout_policy,block_when_leave_approved,allow_remote_checkin}); field→cột THẬT 0452 (grace trên shifts, KHÔNG seed cột không tồn tại); idempotent qua SeedTrackingService.markItem; seedKey 'attendance.master-data.v1'",
      "(B) integration test LANE_DB: chạy runner trên company test → assert OFFICE_8H + DEFAULT_OFFICE_RULE tồn tại (is_default, đúng giá trị) + chạy lần 2 = Skipped (idempotent); dùng ĐÚNG entry-point runner production (KHÔNG gọi seeder trực tiếp → tránh false-green); app role RLS-enforced",
      "migration 0454 NỐI TIẾP head THẬT lúc mở PR (head hiện 0453 trên feat/s3-wave1) — KHÔNG để 0454 merge master TRƯỚC 0453 (drizzle skip `when` nhỏ hơn); cùng wave PR đảm bảo thứ tự",
    ],
  },
  {
    id: "S3-LEAVE-SEED-1",
    module: "LEAVE",
    layer: "DB",
    title:
      "Seed LEAVE permissions (§11.2) + role→data_scope mapping + leave types (Annual/Sick/Unpaid/Other) + default policy (§12.2) idempotent",
    zone: "red",
    // DONE 2026-06-27 (feat/s3-wave1, 9fd71bf): mig 0455 = 30 cặp catalog/7 resource_type + 83 grant per-pair (least-privilege manager-deny: 0 trên leave-policy/leave-audit-log/leave-file + 0 admin-action leave-balance, GIỮ view-own:Own self-service; CA view-team:leave-calendar=Team) · leave-permissions.const.ts (PIN 30 cho S3-LEAVE-BE) · LeaveMasterDataSeeder (4 type + DEFAULT_ANNUAL quota=12) cắm runner S3-FND-SEEDRUN-1 · 156 lane-spec + 793 regression PASS (mediaos_leaveseed) · FULL gate PASS (security PASS, completion 95/100). ĐÍNH CHÍNH: legacy create:leave re-scope Company→Own áp cho CẢ employee VÀ company-admin (hardening đúng, create là Own-action; KHÔNG regression). Owner ratify is_sensitive (9 cặp false) + per-employee balance (defer HR-flow/§8.4) ở wave-PR. Verify cuối + merge ở wave-PR feat/s3-wave1→master.
    status: "done",
    paths: [
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "apps/api/src/permission/**",
      "apps/api/src/foundation/**",
      "apps/api/src/leave/**",
    ],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-DB-1", "S2-AUTH-SEED-1", "S3-ATT-SEED-1", "S3-FND-SEEDRUN-1"], // perm=migration NỐI TIẾP sau ATT-SEED; master-data=runtime seeder qua S3-FND-SEEDRUN-1
    src: [
      "IMPLEMENTATION-06 §11.2 (catalog 30 mã) + §11.3/§11.0 (data_scope canonical)",
      "API-10 §5.4 + §6.4 (role→action→max-scope — NGUỒN CHUẨN; DB-05 §8.1 STALE 28 mã, §11.2 THẮNG)",
      "IMPLEMENTATION-06 §12.2 (leave type/policy seed) · DB-05 (landed schema: leave_types/leave_policies)",
      "mig 0454 (ATT-SEED-1 pattern NHÂN BẢN) · mig 0063/0441 (legacy 'leave' resource+grant — KHÔNG xoá) · mig 0444 (FLAT roles)",
    ],
    // RECONCILE v2 (2026-06-27, sau research tech-lead — TÁCH 2 phần như S3-ATT-SEED-1: (A) PERMISSION=migration 0455; (B) MASTER-DATA=runtime seeder cắm S3-FND-SEEDRUN-1). Quyết định mặc định (owner chốt ở wave-PR): is_sensitive suy theo triết lý ATT · approve:leave GIỮ non-sensitive (legacy=false, ON CONFLICT không UPDATE; approve là action-gate, masking N/A) · policy = CHỈ DEFAULT_ANNUAL (§12.2 chỉ định lượng annual 12n) · per-employee balance DEFER (HR create-flow/demo §8.4 — BE coi balance rỗng là hợp lệ).
    done_when: [
      "(A) PERMISSION = migration 0455 NỐI TIẾP head (global/system-scoped, AN TOÀN migrate-time): catalog §11.2 = ĐÚNG 30 cặp (action,resource_type) TƯỜNG MINH trên 7 resource_type — leave(11): view-own/view/create/submit/update-draft/cancel-own/approve/reject/cancel-any/revoke/export · leave-type(4): view/create/update/delete · leave-policy(4): view/create/update/delete · leave-balance(4): view-own/view/view-transaction/adjust · leave-calendar(3): view-own/view-team/view-company · leave-file(3): view/upload/delete · leave-audit-log(1): view (CẶP RIÊNG, KHÔNG tái dùng generic audit-log mig 0005); ON CONFLICT(action,resource_type) DO NOTHING (legacy mig 0063 ('read'/'create'/'approve'/'manage','leave') GIỮ NGUYÊN, KHÔNG xoá); is_sensitive=true cho cross-scope/approval-admin/audit/file (self-service view-own/create/submit/cancel-own + view leave-type = false để feed FE tile); PIN 30 cặp vào hằng dùng chung apps/api/src/leave/leave-permissions.const.ts (LEAVE_PERMISSION_COUNT=30) cho S3-LEAVE-BE",
      "(A) ROLE→data_scope BẢNG TƯỜNG MINH per-(role,action,resource) — roles FLAT (mig 0444, KHÔNG kế thừa); 83 hàng grant: self-service (view-own/create/submit/update-draft/cancel-own:leave + view-own:leave-balance + view-own:leave-calendar) = Own cho TẤT CẢ 4 role · view/approve/reject:leave = mgr(Team)+hr+CA(Company) · cancel-any/revoke/export:leave = hr+CA(Company) · view-team:leave-calendar = mgr+hr+CA(Team, CA KHÔNG vượt max=Team) · view-company:leave-calendar = hr+CA(Company) · view:leave-type = cả 4 role(Company) · TYPE/POLICY write + leave-balance view/view-transaction/adjust + leave-audit-log = CHỈ hr+CA(Company); **LEAST-PRIVILEGE (owner ①): manager KHÔNG grant nào trên leave-policy/leave-balance/leave-audit-log/leave-file + KHÔNG cancel-any/revoke/export — manager (✓)=grantable-not-default**; pattern mig 0454 per-cặp DELETE wrong-scope + INSERT ON CONFLICT(role_id,permission_id,effect), CẤM blanket DELETE (giữ legacy media/parked grants); re-scope legacy employee create:leave Company→Own đúng hardening",
      "(A) deny + positive test TỪNG role (lane LANE_DB): emp/mgr/hr/CA đều Own self-service; manager COUNT(*)=0 trên ('leave-policy','leave-balance','leave-audit-log','leave-file') + KHÔNG cancel-any/revoke/export (deny — chống over-grant); emp KHÔNG có view/approve/reject:leave; cross-tenant RLS deny dùng app role (mediaos_app, KHÔNG owner bypass); idempotent ĐO BỘ BA (role_id,permission_id,data_scope)",
      "(B) LEAVE MASTER-DATA SEEDER (RUNTIME — đăng ký MasterDataSeederRegistry của S3-FND-SEEDRUN-1, KHÔNG seed trong migration): 4 leave_types ANNUAL/SICK/UNPAID/OTHER theo §12.2 (paid/deduct_balance/allow_half_day/min_notice_days/sort_order/is_system_default; status='active' lowercase = chk leave_types) + 1 leave_policy DEFAULT_ANNUAL (policy_scope='Company', leave_type_id→ANNUAL [NOT NULL=per-type], yearly_quota_days=12, status='Active' TitleCase = chk leave_policies); field→cột THẬT (leave_types/leave_policies trong schema/hr.ts+leave.ts mig 0453, KHÔNG seed cột không tồn tại; half-day/min-notice sống trên leave_types KHÔNG trên policy); idempotent qua SeedTrackingService + onConflictDoNothing partial-unique (company_id,code|policy_code) WHERE deleted_at IS NULL; seedKey 'leave.master-data' v1; seed types TRƯỚC rồi resolve ANNUAL id cho policy",
      "(B) integration test LANE_DB: chạy ĐÚNG entry-point runner.reconcileCompany trên company test → assert 4 type + DEFAULT_ANNUAL policy tồn tại (đúng giá trị, is_system_default, quota=12) + chạy lần 2 = Skipped (idempotent, count không nhân đôi); app role RLS-enforced (KHÔNG gọi seeder.seed() trực tiếp → tránh false-green)",
      "WIRING: LeaveModule import SeedModule + LeaveSeedRegistrar (OnModuleInit) — mirror attendance.module.ts; KHÔNG sửa module-app-metadata.ts (FE tile gating = S3-FE-REGISTRY-1 re-point sang ('view-own','leave')); migration 0455 NỐI TIẾP head THẬT (head 0454 trên feat/s3-wave1, idx 135 when 1717500670000) — cùng wave PR đảm bảo thứ tự 0453→0454→0455 (drizzle skip when nhỏ hơn)",
    ],
  },

  // ── ATT Backend (crown — check-in/out·data-scope·audit) ──
  {
    id: "S3-ATT-BE-1",
    module: "ATT",
    layer: "BE",
    title:
      "ATT Today + check-in + check-out: resolve employee/shift/rule (server-time) + chặn Approved full-day leave + attendance_records tx (0-dup) + attendance_logs + tính late/early/missing + audit",
    zone: "red",
    // DONE 2026-06-27 (feat/s3-wave1): rewrite getToday/checkIn/checkOut sang DB-04 §7. Repo: resolveEmployeeByUserIdTx (server-side, employment gate) · resolveEffectiveShift/RuleTx (Employee≻Dept≻Company≻System, fallback OFFICE_8H/DEFAULT_OFFICE_RULE, no-shift KHÔNG 500) · findApprovedFullDayLeaveTx (status duality 'approved'∪'Approved', duration FullDay/MultipleDays/NULL) · insertAttendanceLogTx (APPEND-ONLY). Service: server-time authoritative (client_time chỉ tham chiếu trên log) · attendance_records ghi CẢ cột legacy (user_id) + DB-04 additive (employee/shift/rule/working/missing/attendance_status TitleCase/calculation_snapshot) trong tx · 0-dup app-guard + 23505 backstop · audit 'attendance.check_in/out' objectType='attendance_record' + outbox in-tx · first/last_log_id backfill. Logic: shift-aware pure helpers (shiftLate/EarlyLeave/working/missing/check{In,Out}TitleStatus). Controller: today read→view-own (isSensitive) + cặp từ attendance-permissions.const (anti-drift); check-in/out giữ nguyên. Contracts additive: clientTime/clientTimezone/note + V2 schemas. TDD: attendance-be1.service.spec (17) + logic.spec (+20) + attendance-be1.int.spec (7: happy/0-dup/leave-dual/cross-tenant/server-time/HTTP view-own gate). Verify lane mediaos_attbe1: attendance 297 PASS · full suite 3549 PASS/0 fail · typecheck+build green. NO migration (mig 0452/0454 đã có sẵn cột/audit-type/grant).
    status: "done",
    paths: ["apps/api/src/attendance/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-ATT-SEED-1", "S2-AUTH-BE-2", "S2-HR-BE-1"],
    src: [
      "IMPLEMENTATION-06 §8.1 §10.1 (today/check-in/check-out)",
      "ISSUE-BOARD-01 §18.6 (ATT-BE-001/002/003)",
      "API-04",
      "SPEC-04",
      "IMP02-STORY-038/039/040",
    ],
    done_when: [
      "GET /attendance/today: resolve current employee từ auth+HR mapping (KHÔNG tin employee_id client) + employment status hợp lệ + effective shift/rule (Employee→Department→Company, fallback OFFICE_8H/DEFAULT_OFFICE_RULE, no-effective-shift KHÔNG 500) + allowed actions + disabled reason (gồm 'đã có đơn nghỉ duyệt')",
      "POST /attendance/check-in + /check-out: DÙNG SERVER TIME (client_time chỉ tham khảo — §6.2); chặn full-day Approved leave; tạo/update attendance_records trong tx; UNIQUE chống double-check-in tạo trùng; ghi attendance_logs mỗi lần; tính late/early/missing/working_minutes theo rule snapshot",
      "permission ATT.ATTENDANCE.CHECK_IN/CHECK_OUT + company_id từ auth context; audit log (actor/action/target/timestamp) mỗi check-in/out; noti event/stub nếu rule cần",
      "deny-path RED viết-TRƯỚC: no employee mapping → 403/error rõ; employee resigned KHÔNG check-in; spam check-in 0-dup; full-day leave → cả 2 nút disable; cross-tenant deny",
    ],
  },
  {
    id: "S3-ATT-BE-2",
    module: "ATT",
    layer: "BE",
    title:
      "ATT records read: my-records + records/{id} detail + team-records + records(HR) theo data-scope Own/Team/Dept/Company + pagination/filter/sort whitelist + mask GPS/IP/device + no N+1",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/attendance/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-ATT-BE-1"],
    src: [
      "IMPLEMENTATION-06 §8.2 §10.1 (records/detail/team/company)",
      "ISSUE-BOARD-01 §18.6 (ATT-BE-004)",
      "API-04",
      "IMP02-STORY-041/042",
    ],
    done_when: [
      "GET /attendance/my-records (Own) + /records/{id} (detail+logs) + /team-records (Team/Dept) + /records (Company) qua DataScopeService (tái dùng S2-AUTH-BE-2 resolver) — list chỉ phạm vi đúng; pagination + filter (tháng/khoảng ngày/status/phòng ban) + sort whitelist",
      "mask GPS/IP/device trong list response; KHÔNG trả sensitive field nếu thiếu ATT.ATTENDANCE.VIEW_SENSITIVE (masking SERVER); batch-load employee summary chống N+1",
      "deny-path RED: employee scope Own KHÔNG thấy người khác; manager chỉ team đúng scope; direct URL record ngoài scope → 403/404 theo policy; cross-tenant deny; coverage vùng nhạy cảm ≥80%",
    ],
  },
  {
    id: "S3-ATT-BE-3",
    module: "ATT",
    layer: "BE",
    title:
      "Shift/rule minimum (P1): GET /attendance/shifts + /rules/effective + resolve-effective service + applied-rule snapshot (+ CRUD shift/rule/assignment mức tối thiểu nếu đủ thời gian)",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/src/attendance/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-ATT-SEED-1"],
    src: [
      "IMPLEMENTATION-06 §8.3 §10.1 (shift/rule)",
      "ISSUE-BOARD-01 §18.6 (ATT-BE-005 phần shift/rule)",
      "API-04",
      "IMP02-STORY-043/044/045",
    ],
    done_when: [
      "GET /attendance/shifts (list) + GET /attendance/rules/effective (rule hiệu lực) permission ATT.SHIFT.VIEW/ATT.RULE.VIEW; service resolveEffectiveShiftRule dùng chung với S3-ATT-BE-1",
      "applied_rule/calculation snapshot lưu khi tính attendance_records (rule đổi KHÔNG sai dữ liệu quá khứ — §16); CRUD shift/rule/assignment (HR/Admin, permission CREATE/UPDATE/CONFIG) chỉ làm mức tối thiểu — phần nâng cao = carry-over CO-S4-007",
      "deny-path: thiếu permission → 403; 2-tenant deny; audit cho config shift/rule",
    ],
  },

  // ── LEAVE Backend (crown — workflow phê duyệt + balance ledger) ──
  {
    id: "S3-LEAVE-BE-1",
    module: "LEAVE",
    layer: "BE",
    title:
      "LEAVE balance + types + calculation preview: GET /leave/types + GET /leave/me/balances (Own) + POST /leave/calculate (preview ngày/giờ + holiday/non-working-day + balance trước/sau)",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/leave/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-SEED-1", "S2-AUTH-BE-2", "S2-HR-BE-1"],
    src: [
      "IMPLEMENTATION-06 §8.4 §10.2 (balance/types/calculate)",
      "ISSUE-BOARD-01 §18.7 (LEAVE-BE-001/002)",
      "API-05",
      "IMP02-STORY-052/053",
    ],
    done_when: [
      "GET /leave/types (active) + GET /leave/me/balances (Own — employee chỉ balance của mình, theo leave type: used/reserved/remaining); permission LEAVE.TYPE.VIEW / LEAVE.BALANCE.VIEW",
      "POST /leave/calculate: preview số ngày/giờ nghỉ + check holiday/non-working-day (tái dùng HolidayService) + balance trước/sau; KHÔNG tin leave_calculated_days/balance_after từ client (§6.2); KHÔNG mutate balance/tạo request",
      "deny-path RED: employee KHÔNG xem balance người khác; thiếu permission → 403; cross-tenant deny; balance đọc qua withTenant+RLS",
    ],
  },
  {
    id: "S3-LEAVE-BE-2",
    module: "LEAVE",
    layer: "BE",
    title:
      "LEAVE request workflow (me): create draft + update draft + submit + list + detail + cancel + validate (overlap/balance/min-notice) + leave_request_days + reserve + audit + event SUBMITTED",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/leave/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-BE-1"],
    src: [
      "IMPLEMENTATION-06 §8.5 §10.2 (request workflow)",
      "ISSUE-BOARD-01 §18.7 (LEAVE-BE-003)",
      "API-05",
      "IMP02-STORY-054/055/056",
    ],
    done_when: [
      "POST /leave/requests (draft) + PATCH /{id} (update draft) + POST /{id}/submit + GET /leave/me/requests + GET /{id} + POST /{id}/cancel; employee scope Own (KHÔNG tạo cho employee khác — resolve từ auth); Draft sửa được, Pending KHÔNG sửa trực tiếp; submit Draft→Pending",
      "validate type/duration/date-range/required-fields/balance(không âm nếu policy cấm)/min-notice; OVERLAP: từ chối 422 nếu trùng (kể cả 1 phần half-day) với đơn Approved/Pending CÙNG employee (Rejected/Cancelled/Revoked KHÔNG tính) — báo rõ đơn/ngày trùng (§8.5 AC)",
      "tạo leave_request_days khi preview/submit (đủ cho ATT sync sau approve); reserve balance qua leave_balance_transactions nếu policy yêu cầu; ghi approval log 'Submitted'; audit; phát event LEAVE_REQUEST_SUBMITTED",
      "deny-path RED viết-TRƯỚC: tạo hộ người khác → chặn; submit thiếu field bắt buộc → 422; vượt balance → 422; cancel Pending→Cancelled theo policy; cross-tenant deny",
    ],
  },
  {
    id: "S3-LEAVE-BE-3",
    module: "LEAVE",
    layer: "BE",
    title:
      "LEAVE approval workflow: pending-list theo scope + approve + reject(reason) + state-machine Pending→Approved/Rejected + balance reserve→use/release (row-lock, no double-approve) + approval history + audit + event + trigger ATT sync",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/leave/**", "apps/api/src/permission/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-BE-2", "S2-INT-2"],
    src: [
      "IMPLEMENTATION-06 §8.6 §10.2 (approval)",
      "ISSUE-BOARD-01 §18.7 (LEAVE-BE-004)",
      "API-05",
      "IMP02-STORY-057/058",
    ],
    done_when: [
      "GET /leave/requests?status=Pending theo data-scope (Manager=Team direct_manager · HR=Company — tái dùng S2-INT-2 manager-tree) + POST /{id}/approve + POST /{id}/reject (reason bắt buộc); permission LEAVE.REQUEST.APPROVE/REJECT + scope check TRƯỚC khi chạm dữ liệu",
      "state-machine Pending→Approved/Rejected (row-lock + idempotency key chống double-approve trừ phép 2 lần — §16); approve: convert reserve→use HOẶC trừ balance qua leave_balance_transactions; reject: release reserve; ghi leave_request_approvals (history mọi action)",
      "audit log; phát event LEAVE_REQUEST_APPROVED/REJECTED; approve → TRIGGER LEAVE→ATT sync (gọi handler S3-INT-1) trong/sau tx nhất quán",
      "deny-path RED viết-TRƯỚC: manager KHÔNG thấy/duyệt đơn ngoài team; HR chỉ company nếu có quyền; direct API approve ngoài scope → 403; reject KHÔNG tạo attendance leave record; cross-tenant deny; coverage ≥80%",
    ],
  },
  {
    id: "S3-LEAVE-BE-4",
    module: "LEAVE",
    layer: "BE",
    title:
      "LEAVE type/policy management + HR balance view/adjust + ledger (P1): CRUD type/policy + HR view balances + adjust balance (mọi thay đổi qua leave_balance_transactions, no negative ngoài policy)",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/src/leave/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-SEED-1", "S2-AUTH-BE-2"],
    src: [
      "IMPLEMENTATION-06 §8.4 §10.2 (type/policy/balance admin)",
      "ISSUE-BOARD-01 §18.7 (LEAVE-BE-006)",
      "API-05",
      "IMP02-STORY-061/062/063",
    ],
    done_when: [
      "CRUD leave types + leave policies (HR, permission LEAVE.TYPE.* / LEAVE.POLICY.*); soft-delete KHÔNG hard-delete; audit thao tác",
      "HR view balances theo scope + adjust balance (permission LEAVE.BALANCE.ADJUST) — KHÔNG sửa số dư nếu KHÔNG tạo leave_balance_transactions (ledger); balance KHÔNG âm nếu leave type không cho phép (transaction + row-lock)",
      "deny-path: thiếu permission → 403; 2-tenant deny; phần admin UI nâng cao = carry-over CO-S4-008",
    ],
  },

  // ── Integration (crown — LEAVE→ATT sync) ──
  {
    id: "S3-INT-1",
    module: "BACKEND",
    layer: "INT",
    title:
      "LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService (full-day=Leave/required 0 · half-day/hourly reduce · recalc existing check-in) + sync_status/retry + onLeaveCancelled/Revoked recalc + balance restore idempotent (S3-SYNC-004)",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/attendance/**", "apps/api/src/leave/**", "apps/api/test/**"],
    skills: ["code-review"],
    depends_on: ["S3-ATT-BE-1", "S3-LEAVE-BE-3"],
    src: [
      "IMPLEMENTATION-06 §8.7 §10.1 (sync + /internal recalculate)",
      "ISSUE-BOARD-01 §18 (EPIC-10)",
      "IMP02-STORY-064/100",
      "IMPLEMENTATION-06 §21 (CO-S4-009)",
    ],
    done_when: [
      "internal handler onLeaveApproved + AttendanceLeaveSyncService map leave_request_days→attendance_records: full-day → status Leave + required_working_minutes 0; half-day → reduce required minutes; hourly → reduce theo minutes; nếu record đã có check-in/out → recalculate (KHÔNG mất dữ liệu chấm công); KHÔNG tạo trùng record (employee/date/shift)",
      "cập nhật leave_request_days.attendance_sync_status; lưu sync error nếu fail + log; POST /internal/v1/attendance/recalculate (retry/manual); attendance/today + check-in đọc Approved leave để chặn full-day",
      "onLeaveCancelled/onLeaveRevoked cho đơn ĐÃ Approved+đã sync: recalc attendance_records (gỡ Leave, khôi phục required minutes về shift/rule hiệu lực, tính lại late/early/missing nếu có check-in) + release/restore balance ĐÚNG SỐ; IDEMPOTENT (retry KHÔNG hoàn phép 2 lần — idempotency key / kiểm sync state) — S3-SYNC-004",
      "deny-path RED viết-TRƯỚC: full-day leave date → check-in/out disabled + status Leave trong bảng công; sync fail → trạng thái lưu + log; cross-tenant KHÔNG sync chéo; FULL gate (crown) + người chốt; coverage ≥80%",
    ],
  },

  // ── Frontend (registry → ATT pages → LEAVE pages) ──
  {
    id: "S3-FE-REGISTRY-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE registry + API layer ATT/LEAVE: app/sidebar/route registry (permission-driven) + attendanceApi/leaveApi + query-key factory + mutation invalidation matrix",
    zone: "green",
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["code-review"],
    // depends_on +S3-ATT-SEED-1/+S3-LEAVE-SEED-1 (chốt owner 2026-06-26): cặp (action,resource_type) cho route mới
    //   cần NGUỒN CHUẨN từ seed §11 đã land — pin test theo seed THẬT, không theo mã FE (bài học S1-FND-MODULE).
    depends_on: ["S2-FE-AUTH-1", "S1-FE-REGISTRY-1", "S3-ATT-SEED-1", "S3-LEAVE-SEED-1"],
    src: [
      "IMPLEMENTATION-06 §8.8 (FE integration chung)",
      "ISSUE-BOARD-01 §18.6/§18.7 (ATT/LEAVE FE)",
      "FRONTEND-03",
      "UI-03",
      "UI-04",
    ],
    done_when: [
      "ĐỘI 1 LƯU Ý: web-core (CORE) + apps/app (APP) KHÔNG độc lập (APP import web-core, router gọi getMeta đọc ROUTE_REGISTRY của CORE) → phân rã 1 LANE DUY NHẤT (frontend-builder, cùng cây tuần tự), KHÔNG 2 lane worktree song song",
      "app registry + sidebar registry thêm ATT/LEAVE sinh menu từ metadata (permission/scope/module/status — KHÔNG hard-code role); route registry cho routes §8.8 (/attendance/*, /leave/*); app inactive/thiếu setting → ẩn; cặp (action,resource_type)+data_scope cho route mới khớp NGUỒN CHUẨN seed §11 đã land — pin test theo seed THẬT (bài học S1-FND-MODULE), KHÔNG theo mã FE",
      "FAIL-CLOSED scope: route+sidebar Team/Company (team-records, /records company, /leave approvals, calendar) BẮT BUỘC requiredScopes:[Team]/[Company] (vì VIEW_* map về read:attendance/read:leave — thiếu scope = lọt); test data-scope RED-trước cho CẢ route guard LẪN filterSidebarItems với session.modules ĐƯỢC populate (active/inactive/hidden — modules:[] = test xanh-giả)",
      "attendanceApi + leaveApi service modules (web-core, typed apiFetch — KHÔNG nhận/forward company_id, KHÔNG đụng token-storage) + query-key factory ATT/LEAVE (APPEND key mới today/team/records.detail — KHÔNG đổi tên key cũ) + mutation invalidation matrix (check-in/out → today+my-records; approve → list+detail+balance)",
      "DEFER chống scope-creep: /leave/calculate preview (chưa có contract @mediaos/contracts) → hoãn sang S3-FE-LEAVE-1; /leave/settings/policies giữ ModulePlaceholder (KHÔNG dựng leaveApi.policy ở WO này); web test registry+guard xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-ATT-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE ATT Today: AttendanceTodayPage + AttendanceStatusCard + CheckInOutActions + useAttendanceToday/useCheckIn/useCheckOut + disabled reason + invalidate + toast + state",
    zone: "green",
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-ATT-BE-1", "S3-FE-REGISTRY-1"],
    src: [
      "IMPLEMENTATION-06 §8.1 (FE today)",
      "ISSUE-BOARD-01 §18.6 (ATT-FE-001)",
      "FRONTEND-06",
      "UI-03",
    ],
    done_when: [
      "route /attendance/today + AttendanceTodayPage + AttendanceStatusCard + CheckInOutActions nối GET /attendance/today; chưa check-in→Check-in enable; sau check-in→Check-out enable; sau check-out/full-day-leave→cả 2 disable + disabled reason rõ",
      "useAttendanceToday + useCheckIn/useCheckOut; invalidate today+my-records sau mutation; toast success/error; loading/empty/forbidden/error state",
      "web test xanh; typecheck xanh; KHÔNG hard-code permission (PermissionGate/useCan)",
    ],
  },
  {
    id: "S3-FE-ATT-2",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE ATT records (P0/P1): MyAttendanceRecordsPage + TeamAttendanceRecordsPage + AttendanceRecordDetailPage + filter tháng/khoảng/status + StatusBadge + permission menu visibility",
    zone: "green",
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-ATT-BE-2", "S3-FE-ATT-1"],
    src: [
      "IMPLEMENTATION-06 §8.2 (FE records)",
      "ISSUE-BOARD-01 §18.6 (ATT-FE-002/003)",
      "FRONTEND-06",
      "UI-03",
    ],
    done_when: [
      "MyAttendanceRecordsPage (Own) + TeamAttendanceRecordsPage (Team, ẩn nếu thiếu quyền) + AttendanceRecordDetailPage nối API thật; columns ngày/ca/check-in/check-out/tổng giờ/status/nguồn; filter tháng/khoảng ngày/status",
      "StatusBadge Present/Late/Early/Missing/Leave; menu team/company hiện/ẩn theo permission; loading/empty/error/forbidden",
      "web test list+detail xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-LEAVE-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE LEAVE me: MyLeaveBalancePage/LeaveBalanceCard + MyLeaveRequestsPage + CreateLeaveRequestPage/LeaveRequestForm (date-range/half-day/preview) + LeaveRequestDetailPage + submit/cancel",
    zone: "green",
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-LEAVE-BE-2", "S3-FE-REGISTRY-1"],
    src: [
      "IMPLEMENTATION-06 §8.4/§8.5 (FE balance/request)",
      "ISSUE-BOARD-01 §18.7 (LEAVE-FE-001/002)",
      "FRONTEND-06",
      "UI-04",
    ],
    done_when: [
      "MyLeaveBalancePage + LeaveBalanceCard (theo leave type: used/reserved/remaining) + MyLeaveRequestsPage (list/status) nối API thật",
      "CreateLeaveRequestPage + LeaveRequestForm (RHF+Zod): date-range picker, duration type, half-day selector, preview box (số ngày/giờ + balance trước/sau qua /leave/calculate); submit/cancel; LeaveRequestDetailPage status stepper; map backend validation (overlap/balance) vào form",
      "web test form+list xanh; typecheck xanh; loading/empty/error/forbidden; dirty-form guard",
    ],
  },
  {
    id: "S3-FE-LEAVE-2",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE LEAVE approval: LeaveApprovalPage + pending table + approval detail drawer + approve/reject confirmation + reject reason + invalidate list/detail/balance",
    zone: "green",
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-LEAVE-BE-3", "S3-FE-LEAVE-1"],
    src: [
      "IMPLEMENTATION-06 §8.6 (FE approval)",
      "ISSUE-BOARD-01 §18.7 (LEAVE-FE-003)",
      "FRONTEND-06",
      "UI-04",
    ],
    done_when: [
      "LeaveApprovalPage + pending request table (theo scope) + approval detail drawer/modal + approve/reject confirmation + reject reason textarea; approve/reject button ẩn nếu thiếu quyền (PermissionGate)",
      "invalidate list/detail/balance sau mutation; loading/empty/error/forbidden",
      "web test xanh; typecheck xanh",
    ],
  },

  // ── QA (deny-path + integration ATT↔LEAVE + regression) ──
  {
    id: "S3-QA-1",
    module: "QA",
    layer: "QA",
    title:
      "QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/attendance/**/*.spec.ts", "apps/api/test/**", "apps/app/**"],
    skills: ["code-review"],
    depends_on: ["S3-ATT-BE-2", "S3-INT-1"],
    src: [
      "IMPLEMENTATION-06 §13 (test plan) §19.3",
      "ISSUE-BOARD-01 §18.6 (ATT-QA-001/002)",
      "QA-03",
      "CLAUDE.md §6",
    ],
    done_when: [
      "API test ATT: today (chưa/đã check-in/đã check-out/full-day-leave/no-shift) + check-in/out (success/double-click 0-dup/no-employee/resigned/server-time) trên DB cô lập lane",
      "records scope Own/Team/Company + pagination/filter + forbidden cross-scope; list KHÔNG lộ GPS/IP/device; check-in chặn khi full-day leave approved (integration với S3-INT-1)",
      "permission test Employee/Manager/HR/Admin + data-scope cross-team/cross-company deny; regression Auth/HR (login/mapping/manager-scope) xanh; coverage vùng nhạy cảm ≥80%",
    ],
  },
  {
    id: "S3-QA-2",
    module: "QA",
    layer: "QA",
    title:
      "QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/leave/**/*.spec.ts", "apps/api/test/**", "apps/app/**"],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-BE-3", "S3-INT-1"],
    src: [
      "IMPLEMENTATION-06 §13 (test plan) §19.3",
      "ISSUE-BOARD-01 §18.7 (LEAVE-QA-001/002)",
      "QA-03",
      "CLAUDE.md §6",
    ],
    done_when: [
      "API test LEAVE: balance (own/HR/insufficient-permission/ledger integrity) + request (draft/update/submit/validation/overlap-422/cancel) + approval (manager approve team/reject reason/HR company/outside-scope forbidden/no-double-approve) trên DB cô lập lane",
      "integration LEAVE→ATT: Approved full-day → attendance status Leave + disable check-in; half-day reduce minutes; cancel/revoke đơn đã Approved → recalc attendance + restore balance idempotent (S3-SYNC-004)",
      "FE smoke (login→leave balance→create→submit→approve) + regression Auth/HR mapping xanh; `pnpm --filter @mediaos/api test` xanh phạm vi THẬT; coverage vùng nhạy cảm ≥80%",
    ],
  },
];
