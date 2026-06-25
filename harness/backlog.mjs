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
    status: "todo",
    paths: ["apps/api/src/employees/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S2-HR-BE-1", "S2-HR-SEED-1"],
    src: [
      "IMPLEMENTATION-05 §9.3 (HR-S2-104/105/106/107) §11.3 §15.2 §16.2",
      "ISSUE-BOARD-01 §18.5 (HR-BE-003/004)",
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
    status: "todo",
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
    status: "todo",
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
    status: "todo",
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
    status: "todo",
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
    status: "todo",
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
    status: "in_progress",
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
    status: "todo",
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
    status: "todo",
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
    status: "todo",
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
    status: "todo",
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
];
