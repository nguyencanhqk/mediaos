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
    status: "done",
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

  // ════════════════════ CARRY-OVER — AUTH FE screens (self-service + RBAC admin CRUD) ════════════════════
  // SEED 2026-07-01 (owner): bù các màn AUTH còn THIẾU so với FRONTEND-06 §7 (route map) + SPEC-02 §14 (screen).
  //   ĐÃ có: /login (S2-FE-AUTH-1) · /hr/me MyProfile read-only + /system/users·/system/roles READ-ONLY placeholder
  //     (S2-FE-HR-3) · /system/login-logs + /system/security-events (S2-AUTH-BE-5).
  //   BE SẴN (build FE được ngay): forgot/reset/change-password (S2-AUTH-BE-4 ✅) · user admin CRUD /auth/users +
  //     /auth/roles + /auth/permissions (S2-AUTH-BE-3 ✅).
  //   BE CHƯA có (→ chặn FE, seed BE trước): role WRITE + assign-permission (→ S2-AUTH-BE-6) · self-profile update +
  //     user_sessions list/revoke (DEFERRED — xem memory s2-auth-be1-shipped) → S2-FE-AUTH-5 blocked.
  //   Ưu tiên P1 — KHÔNG chặn Sprint 3 (ATT/LEAVE spine); chạy xen khi rảnh. Reconcile-first: thay read-only
  //   placeholder ở /system/users·/system/roles bằng CRUD thật, KHÔNG dựng route/layout mới trùng.
  {
    id: "S2-FE-AUTH-2",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE Auth self-service: forgot-password + reset-password + session-expired (apps/auth) + /account/change-password nối API thật",
    zone: "yellow",
    status: "done",
    paths: ["apps/auth/**", "apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-AUTH-BE-4", "S2-FE-AUTH-1"],
    src: [
      "FRONTEND-06 §7.1/§7.2 (UI-AUTH-SCREEN-002/003/004 · UI-ACCOUNT-SCREEN-003)",
      "SPEC-02 §14.2-14.4",
      "API-02",
      "IMP02-STORY-015/016",
      "UI-04",
    ],
    done_when: [
      "/forgot-password (apps/auth): form email (RHF+Zod) → POST /auth/forgot-password (skipAuth); thông báo GENERIC KHÔNG tiết lộ email tồn tại; link quay lại /login; lỗi rate-limit hiển thị mềm",
      "/reset-password (apps/auth): token lấy từ query-string → POST /auth/reset-password; validate rule mật khẩu + confirm; token sai/hết hạn/đã dùng → lỗi chuẩn KHÔNG lộ user; thành công → điều hướng /login",
      "/session-expired (apps/auth): trang tĩnh + CTA đăng nhập lại (redirect SSO qua getAuthRedirectUrl); wire nhánh refresh-fail của web-core",
      "/account/change-password (apps/app): mật khẩu cũ + mới + confirm → POST /auth/change-password; thành công → BE revoke session → điều hướng /login; loading/error rõ; PermissionGate AUTH.PASSWORD.CHANGE",
      "token KHÔNG vào localStorage/sessionStorage + KHÔNG console.log (BẤT BIẾN #3 — grep chặn); loading/empty/error; web test apps/auth + apps/app xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-FE-AUTH-3",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE User admin CRUD (/system/users): create + detail + edit + assign-roles nối /auth/users (thay read-only placeholder)",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-AUTH-BE-3", "S2-FE-HR-3"],
    src: [
      "FRONTEND-06 §7.3 (UI-AUTH-SCREEN-006/007/008/009)",
      "SPEC-02 §14.7-14.9/§14.13",
      "API-02",
      "IMP02-STORY-018/019/020/021",
      "UI-09",
    ],
    done_when: [
      "/system/users/new: form tạo user (RHF+Zod) → POST /auth/users; mật khẩu hash ở SERVER; validation + error state; PermissionGate AUTH.USER.CREATE",
      "/system/users/:id: detail đọc GET /auth/users/:id — thông tin + roles + trạng thái; nút lock/unlock → POST /auth/users/:id/lock|unlock (PermissionGate AUTH.USER.*); invalidate detail sau thao tác",
      "/system/users/:id/edit: PATCH /auth/users/:id CHỈ dirty fields; dirty-form guard; thành công → invalidate list/detail",
      "/system/users/:id/roles: gán/gỡ role cho user từ catalog GET /auth/roles; PermissionGate AUTH.USER.ASSIGN_ROLE",
      "KHÔNG hard-code role (PermissionGate/useCan); direct URL thiếu quyền → ForbiddenState 403; loading/empty/error; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-AUTH-BE-6",
    module: "AUTH",
    layer: "BE",
    title:
      "Role write API (P1): POST/PATCH /auth/roles (create/update, KHÔNG sửa system role) + assign/revoke permission cho role (role_permissions) có audit — unblock S2-FE-AUTH-4",
    zone: "red",
    status: "done",
    paths: [
      "apps/api/src/permission/**",
      "apps/api/src/users/**",
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-BE-3"],
    src: [
      "API-02",
      "SPEC-02 §12 (roles/permissions)",
      "DB-02",
      "IMP02-STORY-020",
      "ISSUE-BOARD-01 §18.3 (AUTH-BE)",
    ],
    done_when: [
      "POST /auth/roles tạo role (company-scope) + PATCH /auth/roles/:id sửa name/description; role system-defined → KHÔNG cho sửa/xoá; permission guard AUTH.ROLE.CREATE/UPDATE",
      "assign/revoke permission cho role (ghi role_permissions add/remove) qua AUTH.PERMISSION.ASSIGN; ghi audit RoleUpdated/PermissionAssigned trong tx withTenant; permission sensitive KHÔNG auto-grant qua wildcard",
      "SCOPE CEILING (crown — chống leo thang, plan-review 2026-07-01): data_scope gán cho role BẮT BUỘC ≤ Company (canonical Own<Team<Department<Company<System; mig 0441 CỐ Ý DEFAULT 'Company' KHÔNG 'System' để không nới scope). Service REJECT 400 khi dataScope='System' (tenant-admin KHÔNG được gán System = mở lại đúng cái 0441 tránh); lý tưởng CLAMP dataScope ≤ scope actor THỰC giữ (fail-closed, mirror AC-5 userGrantsPermissionIds). RED test: 'assign dataScope=System → 400, 0 role_permissions, 0 audit'",
      "ANTI-ESCALATION (crown, CHỐT 2026-07-02): pin (assign,permission) CHỈ company-admin (KHÔNG ép ≤ grant thực actor — N=1 chưa có non-admin giữ assign:permission, để dành phòng xa cho lúc thực sự cấp per-user). Cặp KHÔNG có trong catalog (findPermissionId=undefined) → 400 (KHÔNG 500/FK error). RED test: 'unknown pair → 400, 0 row, 0 audit'",
      "AUDIT truy vết được: PermissionAssigned/Revoked objectType='role_permission' NHƯNG objectId=role.id (role_permissions không có uuid PK — key = role_id/permission_id/effect) + before/after={action,resourceType,effect,dataScope} đã mask; KHÔNG objectId NULL. Migration (audit object_type CHECK UNION-ADD 'role_permission' + sync AUDIT_OBJECT_TYPES cùng commit) đánh số SAU head ĐÃ MERGE (0456 đã thuộc PR #60 chưa merge → chờ #60 merge rồi số 0457+; verify meta/_journal.json idx+when đơn điệu trên LANE_DB cô lập)",
      "deny-path RED viết-TRƯỚC: thiếu quyền → 403 + 0 audit; 2-tenant KHÔNG sửa role công ty khác (withTenant+RLS); FULL gate (security-reviewer) + người chốt",
    ],
  },
  {
    id: "S2-FE-AUTH-4",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE Role & Permission admin: /system/roles create/detail/edit + assign-permissions + /system/permissions catalog",
    zone: "yellow",
    // WAITING S2-AUTH-BE-6 (role WRITE + assign-permission) — todo, tự lên 'ready' khi BE-6 done. Phần ĐỌC
    //   (/system/permissions catalog + RoleDetail đọc GET /auth/roles) build được ngay; nếu cần chạy sớm, TÁCH
    //   read-part thành S2-FE-AUTH-4a.
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-AUTH-BE-6", "S2-FE-HR-3"],
    src: [
      "FRONTEND-06 §7.3 (UI-AUTH-SCREEN-010..015)",
      "SPEC-02 §14.10-14.14",
      "API-02",
      "IMP02-STORY-020",
      "UI-09",
    ],
    done_when: [
      "/system/roles/new + /:id/edit: form role (RHF+Zod) → POST/PATCH /auth/roles; system role read-only; PermissionGate AUTH.ROLE.CREATE/UPDATE",
      "/system/roles/:id: detail role + danh sách permission đã gán (đọc); /:id/permissions: ma trận gán/gỡ permission → API S2-AUTH-BE-6; PermissionGate AUTH.PERMISSION.ASSIGN",
      "/system/permissions: catalog permission (đọc GET /auth/permissions) filter/search/pagination; PermissionGate AUTH.PERMISSION.VIEW",
      "KHÔNG hard-code role; thiếu quyền → 403; loading/empty/error; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-AUTH-BE-7",
    module: "AUTH",
    layer: "BE",
    title:
      "Session management API (P1): GET /auth/sessions (phiên của CHÍNH user) + revoke 1 phiên + revoke-all-others — hoàn tất user_sessions (DEFERRED ở BE-1) — unblock S2-FE-AUTH-5",
    zone: "red",
    status: "done",
    paths: [
      "apps/api/src/auth/**",
      "apps/api/src/db/schema/audit.ts",
      "apps/api/migrations/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-BE-1"],
    src: [
      "API-02",
      "SPEC-02 §14 (session self-service)",
      "DB-02 (user_sessions §12.1)",
      "ISSUE-BOARD-01 §18.3 (AUTH-BE P1)",
    ],
    done_when: [
      "reconcile user_sessions: login đã dual-write (BE-1) — nếu shape thiếu field cho list (device/ip/last_seen/created) thì migration bổ sung NỐI TIẾP head; GET /auth/sessions liệt kê phiên ACTIVE của CHÍNH user (Own scope, Authenticated), KHÔNG lộ session/refresh token/hash",
      "POST /auth/sessions/:id/revoke thu hồi 1 phiên của CHÍNH user + POST /auth/sessions/revoke-others (giữ phiên hiện tại); phiên bị revoke → refresh/next request fail-closed; ghi audit SessionRevoked trong tx withTenant",
      "AUDIT object_type (CHỐT 2026-07-02): union-add 'user_session' vào AUDIT_OBJECT_TYPES (apps/api/src/db/schema/audit.ts) + CHECK audit_logs CÙNG commit migration (mẫu UNION-ADD 0456); apps/api/src/db/schema/audit.ts PHẢI nằm trong paths lane DB (không out-of-scope guard-scope)",
      "PERMISSION (CHỐT 2026-07-02): session self-service = CHỈ Authenticated + owner-check ở service (KHÔNG cần permission pair riêng, giống pattern /auth/me) — KHÔNG seed pair mới",
      "currentSessionId (CHỐT 2026-07-02): lấy từ session id trong access-token claim/jti của request ĐÃ auth (KHÔNG suy đoán theo thiết bị/IP) — revoke-others dùng giá trị này để loại trừ phiên hiện tại",
      "deny-path RED viết-TRƯỚC: revoke phiên user khác → 403/404; 2-tenant KHÔNG thấy/thu hồi phiên công ty khác (withTenant+RLS); no-secret-log; FULL gate (auth crown — security-reviewer) + người chốt",
    ],
  },
  {
    id: "S2-FE-AUTH-5",
    module: "FRONTEND",
    layer: "FE",
    title: "FE Account self-service: /account/sessions (list + revoke phiên của chính user)",
    zone: "yellow",
    // RECONCILE 2026-07-01: BỎ /account/profile/edit khỏi WO này — self-edit hồ sơ đi qua WORKFLOW change-request
    //   (BE /hr/profile-change-requests ĐÃ có) chứ KHÔNG direct-PATCH → màn đó nay thuộc S2-FE-HR-4 (/hr/me/change-request).
    //   Đã XOÁ S2-HR-BE-5 (direct self-PATCH) vì thừa/sai hướng. WO này chỉ còn /account/sessions.
    //   WAITING S2-AUTH-BE-7 (user_sessions list/revoke) — todo, tự lên 'ready' khi BE-7 done.
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-AUTH-BE-7", "S2-FE-AUTH-1"],
    src: ["FRONTEND-06 §7.2 (UI-ACCOUNT-SCREEN-004)", "SPEC-02 §14", "API-02", "UI-09"],
    done_when: [
      "/account/sessions: bảng phiên đăng nhập của chính user (GET /auth/sessions) + nút thu hồi (POST /auth/sessions/:id/revoke / revoke-others); phiên hiện tại đánh dấu rõ; loading/empty/error",
      "KHÔNG hard-code (PermissionGate/useCan); token KHÔNG vào storage/console (BẤT BIẾN #3); web test xanh; typecheck xanh",
    ],
  },

  // ════════════════════ CARRY-OVER — FOUNDATION System admin FE (console /system/*) ════════════════════
  // SEED 2026-07-01 (owner, từ ảnh UI-02 §9.10 + doc chuẩn FRONTEND-13 §7.1 SYSTEM/FOUNDATION admin routes).
  //   Phần AUTH admin trong bảng (/system/users·roles·permissions) ĐÃ có WO (S2-FE-AUTH-3/4) — FRONTEND-13 §5.2 xác
  //   nhận CRUD user/role/permission thuộc FRONTEND-06, System workspace chỉ đặt menu/link. CÒN THIẾU = phần
  //   FOUNDATION: /system (overview) · company · settings · modules · files · audit-logs. Router apps/app hiện chỉ có
  //   /system + /system/audit-logs = ModulePlaceholder; company/modules/settings/files CHƯA có route.
  //   BE readiness (grep controllers foundation/*): company GET/PATCH /foundation/company/current ✅ · settings
  //   GET public + POST resolve + PATCH company-settings/:key ✅ · audit GET /foundation/audit-logs(+/all,+/:id) ✅ ·
  //   files GET /foundation/files(+/:id,+download) ✅ · modules CHỈ GET /modules/my-apps (lọc theo user) → THIẾU
  //   endpoint admin-catalog (tất cả module) ⇒ S2-FND-BE-1.
  //   ⚠️ Permission-pair drift (memory s1-fnd-module-metadata-seed-drift): Foundation gate theo cặp (action,resource
  //   _type) ĐÃ SEED THẬT (vd view:foundation-company), KHÔNG theo nhãn 'FOUNDATION.COMPANY.VIEW' trong FRONTEND-13 —
  //   pin PermissionGate theo seed thật.  P1 — KHÔNG chặn Sprint 3.
  //   ĐÃ seed nốt (2026-07-01, owner chốt kéo vào): public-holidays · health · sequences · seeds · retention ·
  //   file-access-logs → S2-FE-FND-4/5/6 + S2-FND-BE-2/3 (khối "FOUNDATION ops/security admin" dưới). *-detail
  //   (audit/file/module) đã gộp vào FND-2/3.
  {
    id: "S2-FE-FND-1",
    module: "FOUNDATION",
    layer: "FE",
    title:
      "FE FOUNDATION admin: System Overview (/system) + Company info view/edit (/system/company) + Company Settings (/system/settings) nối API thật",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S1-FND-MODULE-1", "S1-FND-SETTING-1", "S1-FE-REGISTRY-1"],
    src: [
      "FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-001/002/003/004)",
      "UI-02 §9.10",
      "API-09 (FOUNDATION)",
      "UI-09",
      "DB-08 §8.2-8.4",
    ],
    done_when: [
      "/system: System Overview landing (thẻ tóm tắt company/module/health + link tới các trang con); PermissionGate theo cặp quyền ĐÃ SEED (verify pair seed thật — KHÔNG hard-code nhãn FRONTEND-13, bài học s1-fnd-module drift)",
      "/system/company: view + edit thông tin công ty nối GET/PATCH /foundation/company/current; dirty-form guard; confirm hậu quả trước mutation (FRONTEND-13 §6.6); invalidate sau lưu; PermissionGate view/update company",
      "/system/settings (+ /system/company/settings): đọc config qua POST /foundation/settings/resolve (batch known keys) + sửa qua PATCH /foundation/company-settings/:key; field is_sensitive do SERVER mask (§6.3); confirm khi đổi giá trị nhạy cảm",
      "KHÔNG hard-code role (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-FE-FND-2",
    module: "FOUNDATION",
    layer: "FE",
    title:
      "FE FOUNDATION admin: Audit log viewer (/system/audit-logs + detail, thay ModulePlaceholder) + File metadata viewer (/system/files + detail)",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S1-FND-AUDIT-1", "S1-FND-FILE-1", "S1-FE-REGISTRY-1"],
    src: [
      "FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-007/008/010/011)",
      "UI-02 §9.10",
      "API-09 (FOUNDATION)",
      "SPEC-01 §16 (audit)",
      "DB-08 §8.5-8.8",
    ],
    done_when: [
      "/system/audit-logs (+ /:id detail): THAY ModulePlaceholder — bảng audit nối GET /foundation/audit-logs (Company) + /all (System scope nếu đủ quyền) filter module/action/actor/entity/from-to + pagination/sort whitelist; detail GET /foundation/audit-logs/:id; field nhạy cảm ĐÃ mask do server (§6.5)",
      "/system/files (+ /:id detail): bảng file metadata GET /foundation/files + detail /:id; KHÔNG lộ storage_path/signed-url dài hạn; download qua GET /foundation/files/:id/download (backend-mediated, §6.4)",
      "KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-FND-BE-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Admin module catalog API (P1): GET /foundation/modules (TẤT CẢ module, KHÁC my-apps đã lọc theo user) + GET /foundation/modules/:code detail — unblock S2-FE-FND-3 (toggle enable/disable = follow-up)",
    zone: "yellow",
    status: "done",
    paths: ["apps/api/src/foundation/module-catalog/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S1-FND-MODULE-1"],
    src: [
      "API-09 (FOUNDATION)",
      "BACKEND-04 §8/§9",
      "DB-08 §8.2",
      "FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-005/006)",
    ],
    done_when: [
      "GET /foundation/modules trả TẤT CẢ module (active + inactive, deleted_at IS NULL) + trạng thái enabled resolve theo setting module.<code>.enabled; permission FOUNDATION.MODULE.VIEW (cặp seed THẬT); KHÁC /modules/my-apps (my-apps lọc theo permission user + enabled)",
      "GET /foundation/modules/:code detail (metadata/required_permissions hằng MODULE_APP_METADATA + enabled); response envelope chuẩn; contracts Zod dual-build",
      "deny-path RED: thiếu quyền → 403; 2-tenant KHÔNG thấy module công ty khác (withTenant+RLS); toggle enable/disable + audit CONFIG_UPDATE = TÁCH follow-up (crown/red) — WO này READ-ONLY (yellow)",
    ],
  },
  {
    id: "S2-FE-FND-3",
    module: "FOUNDATION",
    layer: "FE",
    title:
      "FE FOUNDATION admin: Module Catalog (/system/modules + /:code detail) nối admin module API — read-only trước",
    zone: "yellow",
    // WAITING S2-FND-BE-1 (admin module list) — todo, tự lên 'ready' khi BE done. my-apps hiện có KHÔNG đủ (lọc theo user).
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-FND-BE-1", "S1-FE-REGISTRY-1"],
    src: [
      "FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-005/006)",
      "UI-02 §9.10",
      "API-09 (FOUNDATION)",
      "UI-09",
    ],
    done_when: [
      "/system/modules: bảng module catalog nối GET /foundation/modules (admin, tất cả module) — code/name/active/enabled; filter/search; PermissionGate FOUNDATION.MODULE.VIEW (cặp seed thật)",
      "/system/modules/:code: detail module (metadata/required-permissions/enabled); toggle enable/disable CHỜ BE follow-up (read-only trước — KHÔNG dựng nút mutation chết)",
      "KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  // ── FOUNDATION ops/security admin — 6 màn còn lại FRONTEND-13 §7.1 (seed 2026-07-01, owner chốt kéo vào) ──
  //   BE (grep): public-holidays GET/POST/PATCH/DELETE ✅ · health GET+db ✅ · sequences/retention CHƯA wire
  //   controller (SequenceService/RetentionService CÓ) · seeds CHƯA có endpoint status · file_access_logs table
  //   CÓ nhưng CHƯA có viewer endpoint → 2 BE wire-over-service (S2-FND-BE-2 yellow · S2-FND-BE-3 red security).
  {
    id: "S2-FE-FND-4",
    module: "FOUNDATION",
    layer: "FE",
    title:
      "FE FOUNDATION admin: Public Holidays (/system/public-holidays list+CRUD) + Health Check (/system/health read-only status) — BE sẵn",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S1-FE-REGISTRY-1"],
    src: [
      "FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-012/016)",
      "API-09 (FOUNDATION)",
      "DB-08 §8.10",
      "UI-09",
    ],
    done_when: [
      "/system/public-holidays: list + CRUD nối GET/POST/PATCH/DELETE /foundation/public-holidays; PermissionGate FOUNDATION.HOLIDAY.VIEW + manage (cặp seed THẬT — KHÔNG hard-code nhãn); confirm khi xoá",
      "/system/health: đọc GET /health + /health/db hiển thị trạng thái (db/uptime); PermissionGate FOUNDATION.HEALTH.VIEW (System); read-only",
      "KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-FND-BE-2",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Foundation ops admin API (P1): Sequences (GET list + preview + PATCH config over SequenceService) + Seed status (GET) — wire controller over service có sẵn — unblock S2-FE-FND-5",
    zone: "yellow",
    // AUDIT 2026-07-02 (FOUNDATION-SYSTEM-AUDIT): controllers ĐÃ TỒN TẠI trên nhánh hiện tại — sequence.controller.ts
    //   (GET list ẩn current_value + GET :id/preview + PATCH :id audit-in-tx) + seed.controller.ts (GET /foundation/seeds,
    //   view:foundation-seed sensitive). ỨNG VIÊN VERIFY-CLOSE: chạy gate + int-spec (sequence-ops-api.int-spec /
    //   master-data-seed-runner.int-spec) rồi đóng qua ledger. Lệch nhỏ vs done_when: preview theo :id (không :key),
    //   preview là GET (doc POST) — chấp nhận, pin ở S2-FND-DOC-1.
    status: "done",
    paths: [
      "apps/api/src/foundation/sequences/**",
      "apps/api/src/foundation/seed/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S1-FND-SEQ-1", "S1-FND-WIRE-1"],
    src: [
      "API-09 (FOUNDATION)",
      "BACKEND-04 §14.5",
      "FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-013/015)",
      "DB-08 §8.9",
    ],
    done_when: [
      "GET /foundation/sequences list counters + GET /foundation/sequences/:id/preview (KHÔNG mutate counter — previewNextCode); PATCH /foundation/sequences/:id config ghi audit SequenceUpdated trong tx (SequenceService có sẵn — CHỈ wire controller); permission FOUNDATION.SEQUENCE.VIEW + manage (cặp seed thật)",
      "GET /foundation/seeds trả seed run status (checksum/last-run, read-only); permission FOUNDATION.SEED.VIEW (System scope)",
      "deny-path RED: thiếu quyền → 403 + 0 audit; 2-tenant deny (withTenant+RLS); envelope chuẩn + contracts Zod dual-build",
    ],
  },
  {
    id: "S2-FE-FND-5",
    module: "FOUNDATION",
    layer: "FE",
    title:
      "FE FOUNDATION admin: Sequence Counters (/system/sequences list+preview+config) + Seed Status (/system/seeds read-only)",
    zone: "yellow",
    // WAITING S2-FND-BE-2 — todo, tự lên 'ready' khi BE-2 done.
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-FND-BE-2", "S1-FE-REGISTRY-1"],
    src: ["FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-013/015)", "API-09 (FOUNDATION)", "UI-09"],
    done_when: [
      "/system/sequences: list counters + preview live + form sửa config nối /foundation/sequences; preview KHÔNG mutate; PermissionGate FOUNDATION.SEQUENCE.VIEW; confirm khi đổi config",
      "/system/seeds: seed run status (read-only, checksum/last-run) nối GET /foundation/seeds; PermissionGate FOUNDATION.SEED.VIEW (System)",
      "KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-FND-BE-3",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Foundation security-admin API (P1): Retention policies (GET + PATCH over RetentionService, governs purge) + File Access Logs viewer (GET masked, append-only) — unblock S2-FE-FND-6",
    zone: "red",
    // AUDIT 2026-07-02 (FOUNDATION-SYSTEM-AUDIT): ĐÃ BUILD phần lớn — retention.controller.ts (GET list +
    //   PATCH manage {isSensitive:true}, audit-in-tx; PROTECTED_TABLES chặn purge audit/access-log = BẤT BIẾN #2 giữ)
    //   + file-access-log.controller.ts (GET masked, không ip/UA/metadata). CÒN THIẾU vs API-09: POST create +
    //   POST /:id/simulate (RetentionService CÓ createPolicy/simulate — route không expose) + guard not-found (hiện
    //   500 thay 404) → ĐÃ CHUYỂN sang S2-FND-BE-8. WO này ứng viên VERIFY-CLOSE sau khi chạy gate + int-spec
    //   retention-api.int-spec / file-access-log-api.int-spec.
    status: "done",
    paths: [
      "apps/api/src/foundation/retention/**",
      "apps/api/src/foundation/files/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S1-FND-WIRE-1", "S1-FND-FILE-1"],
    src: [
      "API-09 (FOUNDATION)",
      "BACKEND-04 §14",
      "FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-009/014)",
      "DB-08 §8.6-8.8",
    ],
    done_when: [
      "GET /foundation/retention-policies + PATCH (System scope, FOUNDATION.RETENTION.VIEW + manage); thay đổi ghi audit trong tx; retention governs data purge → KHÔNG cho purge bảng append-only (audit/ledger/access-log) ngoài policy (BẤT BIẾN #2)",
      "GET /foundation/file-access-logs list (filter file/user/action/from-to + pagination) + MASK (KHÔNG lộ storage_path/signed-url/secret); append-only — KHÔNG endpoint sửa/xoá; permission FOUNDATION.FILE_ACCESS_LOG.VIEW",
      "deny-path RED viết-TRƯỚC: thiếu quyền → 403; 2-tenant deny (withTenant+RLS); no-secret-log; FULL gate (security-reviewer — retention purge + access-log security) + người chốt",
    ],
  },
  {
    id: "S2-FE-FND-6",
    module: "FOUNDATION",
    layer: "FE",
    title:
      "FE FOUNDATION admin: Retention Policies (/system/retention config) + File Access Logs viewer (/system/file-access-logs)",
    zone: "yellow",
    // WAITING S2-FND-BE-3 — todo, tự lên 'ready' khi BE-3 done.
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-FND-BE-3", "S1-FE-REGISTRY-1"],
    src: [
      "FRONTEND-13 §7.1 (UI-SYSTEM-SCREEN-009/014)",
      "API-09 (FOUNDATION)",
      "SPEC-01 §16 (audit)",
      "UI-09",
    ],
    done_when: [
      "/system/retention: form config retention policies nối GET/PATCH /foundation/retention-policies; confirm hậu quả rõ (governs purge — FRONTEND-13 §6.6); PermissionGate FOUNDATION.RETENTION.VIEW (System)",
      "/system/file-access-logs: bảng access log nối GET /foundation/file-access-logs + filter/pagination; field nhạy cảm mask do server (KHÔNG lộ storage_path); PermissionGate FOUNDATION.FILE_ACCESS_LOG.VIEW",
      "KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },

  // ════════════════════ CARRY-OVER — HR FE screens (§9.5 HR routes) ════════════════════
  // SEED 2026-07-01 (owner, từ ảnh UI-02 §9.5 HR routes). ĐÃ có FE: /hr (overview→EmployeeList) · /hr/employees
  //   (+new/:id/edit) (S2-FE-HR-1/2) · /hr/me MyProfile read-only (S2-FE-HR-3). CÒN THIẾU = các WO dưới.
  //   KIỂM BE (grep controllers): profile-change-request FULL ✅ (POST/GET me/GET/GET :id/approve/reject/cancel @
  //   hr/profile-change-requests) · departments CRUD ✅ (hr/departments) · positions CRUD ✅ (org/positions) ·
  //   job-levels + contract-types CRUD ✅ (hr/master-data) · org units/tree ✅ (org/units/tree) · foundation audit
  //   filter module=HR ✅. THIẾU: employee_contracts table KHÔNG tồn tại → S2-HR-BE-6 (STORY-031) · employee-code
  //   admin-edit → S2-HR-BE-7 (STORY-035, bảng employee_code_configs có ở S2-HR-DB-1, chỉ thiếu endpoint sửa).
  //   RECONCILE: self-edit hồ sơ = WORKFLOW change-request (S2-FE-HR-4), KHÔNG direct-PATCH (đã xoá S2-HR-BE-5).
  //   Override quyết-định 2026-06-26 "KHÔNG seed HR carry-over đợt này" — owner nay chốt seed. P1, KHÔNG chặn Sprint 3.
  //   /hr Overview hiện alias EmployeeList (chấp nhận MVP) — KHÔNG seed WO riêng.
  {
    id: "S2-FE-HR-4",
    module: "HR",
    layer: "FE",
    title:
      "FE HR Profile change-request workflow: /hr/me/change-request (self gửi YC) + /hr/profile-change-requests (HR duyệt list) + /:id (detail + approve/reject/cancel)",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-FE-HR-3", "S2-INT-2"],
    src: [
      "UI-02 §9.5 (HR routes)",
      "FRONTEND-06",
      "SPEC-03 (hồ sơ nhân sự · self-service change request)",
      "API-03",
      "permission-matrix-spec (create/view:profile-change-request)",
    ],
    done_when: [
      "/hr/me/change-request: form user tự gửi yêu cầu sửa hồ sơ → POST /hr/profile-change-requests (Own scope); chọn field + giá trị mới + lý do; user tự xem YC của mình qua GET /hr/profile-change-requests/me",
      "/hr/profile-change-requests: HR list GET /hr/profile-change-requests theo scope (Company/System) + filter status; PermissionGate HR.PROFILE_CHANGE_REQUEST.VIEW (cặp seed THẬT, KHÔNG hard-code nhãn)",
      "/hr/profile-change-requests/:id: detail GET /:id + duyệt POST /:id/approve · từ chối POST /:id/reject(reason bắt buộc) · self-cancel POST /:id/cancel; PermissionGate approve/reject; confirm hậu quả trước mutation",
      "KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; invalidate list+detail sau action; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-FE-HR-5",
    module: "HR",
    layer: "FE",
    title:
      "FE HR Master data mgmt: /hr/departments + /hr/positions + /hr/job-levels + /hr/contract-types (list + CRUD) nối API thật",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-FE-HR-1"],
    src: ["UI-02 §9.5 (HR routes)", "FRONTEND-13", "SPEC-03", "API-03", "UI-09"],
    done_when: [
      "/hr/departments: list + CRUD nối /hr/departments (GET/POST/PATCH/DELETE); PermissionGate HR.DEPARTMENT.VIEW + manage (cặp seed thật)",
      "/hr/positions: list + CRUD nối /org/positions (GET/POST/PATCH/DELETE); PermissionGate HR.POSITION.VIEW + manage",
      "/hr/job-levels + /hr/contract-types: list + CRUD nối /hr/master-data/job-levels + /hr/master-data/contract-types; PermissionGate HR.MASTER_DATA.MANAGE",
      "soft-delete KHÔNG hard-delete (server); confirm khi xoá; KHÔNG hard-code; loading/empty/error; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-FE-HR-6",
    module: "HR",
    layer: "FE",
    title:
      "FE HR Org chart (/hr/org-chart, theo data-scope) + HR audit-logs (/hr/audit-logs, tái dùng foundation audit filter module=HR)",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-FE-HR-1", "S2-INT-2"],
    src: [
      "UI-02 §9.5 (HR routes)",
      "FRONTEND-13",
      "SPEC-03",
      "API-03",
      "API-09 (audit)",
      "IMP02-STORY-037",
    ],
    done_when: [
      "/hr/org-chart: sơ đồ tổ chức đọc GET /org/units/tree (+ manager-tree S2-INT-2) theo data-scope (Team/Company/System) — KHÔNG lộ người ngoài quyền; PermissionGate HR.ORG_CHART.VIEW",
      "/hr/audit-logs: lịch sử thay đổi HR — bảng nối GET /foundation/audit-logs?module=HR (tái dùng, KHÔNG dựng endpoint mới) + filter/pagination; field nhạy cảm mask do server; PermissionGate HR.AUDIT_LOG.VIEW",
      "KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-HR-BE-6",
    module: "HR",
    layer: "DB",
    title:
      "Employee contracts (carry-over STORY-031): migration employee_contracts (RLS+FORCE) + CRUD API /hr/contracts + /hr/employees/:id/contracts + file link + cảnh báo hết hạn — unblock S2-FE-HR-7",
    zone: "red",
    // CLOSE 2026-07-02 (worktree auto/s3wave3-batch6-blocked-wos): mig 0462 (idx 142, nối tiếp head 0461)
    //   tạo employee_contracts (RLS ENABLE+FORCE + policy tenant_isolation TRƯỚC backfill, BẤT BIẾN #1;
    //   employee_id→employee_profiles CASCADE + contract_type_id→contract_types + file_id→files SET NULL;
    //   soft-delete + created_by/updated_by/deleted_by; index employee/expiring; ≤1 primary+Active/employee)
    //   + UNION-ADD 'employee_contract' vào CHECK audit_logs + AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit
    //   + seed (view,contract)+(manage,contract) scope=Company cho hr/company-admin (per-pair). rls-registry
    //   đăng ký employee_contracts. CRUD /hr/contracts(+:id) + /hr/employees/:id/contracts (view:contract) +
    //   POST/PATCH/DELETE + POST :id/file (manage:contract) link qua FileService entity 'contract'; cảnh báo
    //   hết hạn 30 ngày (expiringSoon + ?expiringOnly).
    //   REWORK 2026-07-02 (commit 1906559, theo handoff.md owner decision): scope SỬA LẠI thành Own(employee)
    //   + Team(manager) — KHÔNG phải Company-only/403 như mô tả ban đầu ở trên; ngưỡng cảnh báo hết hạn đổi
    //   thành company-configurable 2 mốc [30,7] ngày (SettingService, fallback [30,7]). FULL gate PASS lần 2.
    //   Verify lane DB mediaos_batch6 (chain 0000→0462): int hr-contract ✓14 (deny 403 ×4 · audit-in-tx 1 row ·
    //   soft-delete · RLS 2-tenant read/write/contract_type cross-tenant 400 · PII allowlist · expiry · append-only
    //   UPDATE/DELETE DENIED) + unit contract.service ✓7 + rls-guards/coverage/tenant-isolation ✓412 (0 regression)
    //   + migration-smoke ✓115. typecheck + eslint xanh.
    status: "done",
    paths: [
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "apps/api/src/employees/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-HR-DB-1", "S1-FND-FILE-1"],
    src: [
      "IMP02-STORY-031 (P1 hợp đồng lao động)",
      "DB-03",
      "SPEC-03",
      "API-03",
      "UI-02 §9.5 (HR routes)",
    ],
    done_when: [
      "migration tạo bảng employee_contracts khớp DB-03: company_id NOT NULL · UUID PK · soft-delete · audit cols; employee_id UUID NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE (KHÔNG bảng 'employees' — không tồn tại, đã reconcile sang employee_profiles); contract_type_id NOT NULL REFERENCES contract_types(id); RLS ENABLE+FORCE + policy company_id TRƯỚC backfill; rls-registry đăng ký (BẤT BIẾN #1); index (employee_id, status, effective dates)",
      "CRUD API GET /hr/contracts + GET /hr/employees/:id/contracts + POST/PATCH; permission pair (CHỐT 2026-07-02, pin đúng resource_type='contract'): ('view','contract') cho VIEW + ('manage','contract') cho create/update/delete — @RequirePermission dùng đúng cặp này, KHÔNG hard-code chuỗi khác; file hợp đồng link qua FileService (S1-FND-FILE-1) entity 'contract'; cảnh báo sắp hết hạn (ngưỡng 30 ngày mặc định)",
      "SCOPE (CHỐT 2026-07-02): view:contract CHỈ data_scope='Company' cho hr/company-admin — employee/manager KHÔNG có Own/Team, gọi GET contract → 403 (KHÔNG lọc rỗng). Deny-path RED: employee/manager gọi GET /hr/contracts hoặc /hr/employees/:id/contracts → 403",
      "AUDIT object_type (CHỐT 2026-07-02): union-add 'employee_contract' vào AUDIT_OBJECT_TYPES (apps/api/src/db/schema/audit.ts) + CHECK audit_logs CÙNG commit migration (mẫu UNION-ADD 0456); mỗi Create/Update/Link/Delete PHẢI ghi 1 audit row trong tx (KHÔNG audit-ma khi mutation fail rollback)",
      "DTO list/detail KHÔNG lộ trường nhạy cảm ngoài allowlist (note/metadata/title không chứa lương/PII chưa mask) — test khẳng định",
      "deny-path RED viết-TRƯỚC: thiếu quyền → 403; 2-tenant deny (withTenant+RLS, gồm contract_type cross-tenant); audit thao tác; migration NỐI TIẾP head THEO journal idx thực tế (verify _journal.json, KHÔNG tin tên file/STATUS); FULL gate (migration + PII) + người chốt",
    ],
  },
  {
    id: "S2-FE-HR-7",
    module: "HR",
    layer: "FE",
    title:
      "FE HR Contracts: /hr/contracts (DS hợp đồng) + /hr/employees/:id/contracts (HĐ của nhân viên) nối contract API",
    zone: "yellow",
    // WAITING S2-HR-BE-6 (employee_contracts table + CRUD) — todo, tự lên 'ready' khi BE-6 done.
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-HR-BE-6", "S2-FE-HR-1"],
    src: ["UI-02 §9.5 (HR routes)", "FRONTEND-13", "SPEC-03", "API-03", "UI-09"],
    done_when: [
      "/hr/contracts: DS hợp đồng nối GET /hr/contracts + filter/pagination; cảnh báo sắp hết hạn; PermissionGate HR.CONTRACT.VIEW",
      "/hr/employees/:id/contracts: hợp đồng của 1 NV nối GET /hr/employees/:id/contracts; CRUD nếu đủ quyền; download file HĐ qua backend (KHÔNG lộ storage_path)",
      "KHÔNG hard-code (PermissionGate/useCan); loading/empty/error; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S2-HR-BE-7",
    module: "HR",
    layer: "BE",
    title:
      "Employee-code config admin API (carry-over STORY-035): GET/PATCH /hr/settings/employee-code (sửa employee_code_configs) + lock manual-edit + audit — unblock S2-FE-HR-8",
    zone: "yellow",
    status: "done",
    paths: [
      "apps/api/src/employees/**",
      "apps/api/src/foundation/sequences/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-HR-DB-1", "S1-FND-SEQ-1"],
    src: [
      "IMP02-STORY-035 (P1 cấu hình mã NV)",
      "DB-03",
      "API-03",
      "SPEC-03",
      "UI-02 §9.5 (HR routes)",
    ],
    done_when: [
      "GET /hr/settings/employee-code đọc + PATCH sửa employee_code_configs (prefix/padding/reset policy); permission HR.EMPLOYEE_CODE_CONFIG.VIEW + manage; preview qua previewNextCode (S1-FND-SEQ-1 — KHÔNG mutate counter)",
      "lock manual-edit khi policy yêu cầu; audit thay đổi config trong tx withTenant (config-only, KHÔNG current_value)",
      "deny-path RED: thiếu quyền → 403 + 0 audit; 2-tenant deny; validate value_type",
    ],
  },
  {
    id: "S2-FE-HR-8",
    module: "HR",
    layer: "FE",
    title:
      "FE HR Employee-code config: /hr/settings/employee-code (form cấu hình mã NV + preview live) nối admin API",
    zone: "yellow",
    // WAITING S2-HR-BE-7 (employee-code admin edit) — todo, tự lên 'ready' khi BE-7 done.
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-HR-BE-7", "S2-FE-HR-1"],
    src: ["UI-02 §9.5 (HR routes)", "FRONTEND-13", "SPEC-03", "API-03"],
    done_when: [
      "/hr/settings/employee-code: form cấu hình mã NV (prefix/padding/reset) nối GET/PATCH /hr/settings/employee-code + preview live (KHÔNG mutate); PermissionGate HR.EMPLOYEE_CODE_CONFIG.VIEW",
      "confirm khi đổi cấu hình; KHÔNG hard-code; loading/empty/error; web test xanh; typecheck xanh",
    ],
  },

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
  // Carry-over §21 (CO-S4-003..008): adjustment · remote-work · leave calendar · export/reports · shift/rule +
  //   leave-policy admin UI. ĐÃ ĐẢO CHIỀU 2026-07-01 (owner chốt kéo lên): nay SEED thành WO ở khối "CARRY-OVER —
  //   ATT/LEAVE P1/P2" cuối file (S3-ATT-BE-4/5/6 · S3-FE-ATT-3..6 · S3-LEAVE-BE-5/6 · S3-FE-LEAVE-3..6) — waiting
  //   sau P0-spine (không giành lane với check-in/approval core). Bảng adjustment/remote-work skeleton ở S3-ATT-DB-1;
  //   BE-4/5 hoàn thiện cột nếu thiếu. hourly-leave vẫn để ngỏ nếu giảm scope.
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
    // DONE 2026-06-27 (feat/s3-wave1): rewrite getToday/checkIn/checkOut sang DB-04 §7. Repo: resolveEmployeeByUserIdTx (server-side, employment gate) · resolveEffectiveShift/RuleTx (Employee≻Dept≻Company≻System, fallback OFFICE_8H/DEFAULT_OFFICE_RULE, no-shift KHÔNG 500) · findApprovedFullDayLeaveTx (status duality 'approved'∪'Approved', duration FullDay/MultipleDays/NULL) · insertAttendanceLogTx (APPEND-ONLY). Service: server-time authoritative (client_time chỉ tham chiếu trên log) · attendance_records ghi CẢ cột legacy (user_id) + DB-04 additive (employee/shift/rule/working/missing/attendance_status TitleCase/calculation_snapshot) trong tx · 0-dup app-guard + 23505 backstop · audit 'attendance.check_in/out' objectType='attendance_record' + outbox in-tx · first/last_log_id backfill. Logic: shift-aware pure helpers (shiftLate/EarlyLeave/working/missing/check{In,Out}TitleStatus). Controller: today read→view-own (isSensitive) + cặp từ attendance-permissions.const (anti-drift); check-in/out giữ nguyên. Contracts additive: clientTime/clientTimezone/note + V2 schemas. TDD: attendance-be1.service.spec (17) + logic.spec (+20) + attendance-be1.int.spec (7: happy/0-dup/leave-dual/cross-tenant/server-time/HTTP view-own gate). Verify lane mediaos_attbe1: attendance 297 PASS · full suite 3549 PASS/0 fail · typecheck+build green. NO migration (mig 0452/0454 đã có sẵn cột/audit-type/grant). FULL gate PASS: security-reviewer PASS (0 CRIT/HIGH — tenant/append-only/permission/PII/server-time/0-dup/IDOR verified; INFO: legacy non-BE-1 routes read/manage:attendance orphaned post-0444 → follow-up reconcile WO), completion 86/100 → đã vá objection >800 dòng: refactor f4263820 tách attendance.service.ts 1186→790 (mappers/builders/types, 297 PASS không đổi, no behavior change). Verify cuối + merge ở wave-PR feat/s3-wave1→master.
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
    // DONE 2026-06-27 (feat/s3-wave1, fdc45ed5): 5 route đọc theo scope (my-records self-locked user.id · team-records view-team→Team · records view-company→Company · records/:id + /logs view-detail, out-of-scope→404 no-grant→403) qua DataScopeService (resolveAndAssert gate + buildEmployeeScopeCondition, INNER JOIN employee_profiles ON user_id+company_id). MASK SERVER: list KHÔNG có location/gps/ip/device; detail locationJson null trừ view-sensitive; logs mask 9 field (gps*/locationLabel/ip/device*/userAgent/rawPayload) trừ view-sensitive, KHÔNG own-bypass; reveal = permission.can(view-sensitive,isSensitive:true) page-uniform (wildcard *:* không thoả). No N+1 (1 page + 1 count query, join users/org_units). Sort Zod-enum whitelist (no ORDER BY injection), pageSize≤100. Files mới attendance-read.{service,repository,mappers}.ts (<800, service.ts giữ 790). NO migration. TDD: read-unit 16 + be2.int 14 (entry-point thật AppModule+supertest+login, planted EMR rows). Verify lane mediaos_attbe2: attendance 327 PASS · full 3579 PASS/0 fail · typecheck+build green. FULL gate PASS (security PASS 0-CRIT, completion 94/100). Verify cuối + merge ở wave-PR.
    status: "done",
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
    // DONE 2026-07-01 (feat/s3-wave3, worktree auto/S3-ATT-BE-3). CRUD shift/rule/assignment (min) + GET
    //   /attendance/shifts + /rules/effective (reuse S3-ATT-BE-1 resolveShiftAndRule) shipped earlier;
    //   S3-ATT-BE-3-FIX-AUDIT-WIRE closes AC#3: wired AuditService.record() IN-TX at the 5 config-mutation
    //   sites (createShift/updateShift → ShiftCreated/Updated 'shift'; createRule/updateRule →
    //   RuleCreated/Updated 'attendance_rule'; createShiftAssignment → ShiftAssignmentCreated
    //   'shift_assignment'). before/after = config-only snapshot (shiftSnapshot/ruleSnapshot/
    //   assignmentSnapshot — strip createdAt/updatedAt; tables carry NO secret/PII; masker re-masks —
    //   BẤT BIẾN #3). Config đổi cách tính công toàn công ty = 'hành động quan trọng' (SPEC-01 §16.3).
    //   SCOPE RECONCILED: paths extended to migrations/** + db/schema/audit.ts — the audit_logs object_type
    //   CHECK needs 'shift'/'attendance_rule'/'shift_assignment' (mig 0457 UNION ADD-only, clone 0456; +
    //   AUDIT_OBJECT_TYPES sync) delivered in THIS WO (option (a) of the reviewer's paths↔done_when fix).
    //   Tests: attendance-shift.service.spec.ts +6 audit-wiring (same-tx, config-only, no-audit-on-404);
    //   att-core-tenant-deny.int-spec.ts +6 HTTP (audit ShiftCreated/Updated/RuleCreated/AssignmentCreated
    //   land with correct object_type via 0457 CHECK; QA-06 2-tenant WRITE deny: B PATCH A's shift/rule →
    //   404, A row unchanged, NO cross-tenant audit row). Verify lane mediaos_s3attbe3fix: attendance 336
    //   PASS · typecheck green. Advanced CRUD (delete/bulk/filter) = carry-over CO-S4-007.
    status: "done",
    paths: [
      "apps/api/src/attendance/**",
      "packages/contracts/src/**",
      // SCOPE RECONCILE (S3-ATT-BE-3-FIX-AUDIT-WIRE): audit-in-tx needs the audit_logs object_type CHECK
      // widened → migration + schema constant. UNION ADD-only (append-only #2 nguyên vẹn, KHÔNG rewrite).
      "apps/api/migrations/**",
      "apps/api/src/db/schema/audit.ts",
    ],
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
      "deny-path: thiếu permission → 403; 2-tenant deny (WRITE: tenant B dùng shiftId/ruleId của A → 404, KHÔNG lộ/ghi xuyên tenant); audit-in-tx cho config shift/rule (object_type shift/attendance_rule/shift_assignment, mig 0457 CHECK; before/after config-only, KHÔNG secret/PII)",
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
    // DONE 2026-06-27 (feat/s3-wave1, e57a034e): 3 route read/preview. GET /leave/types RE-GATE read:leave(mồ côi)→view:leave-type (net access fix 4 role canonical) + richer DTO. GET /leave/me/balances view-own:leave-balance, ghim user_id=actor.id (IDOR-safe), empty→[]. POST /leave/requests/calculate (API-05 §16.1 canonical, KHÔNG shorthand /leave/calculate — spec-wins) gate create:leave (view:leave sensitive emp không có). Calculate: HolidayService.getHolidaysInRange (batch, predicate affectsLeaveCalculation≠affectsAttendance) + workingDays resolveWorkingDaysForUserTx + HOURS_PER_DAY=8; balance before/after từ remainingDays GENERATED (read-only) or 0; KHÔNG mutate (preview thuần, verify count 3 bảng + used_days bất biến); Zod strip client calculated_days/balance_after/employee_id. NO migration. TDD: calc unit 9 + be1.int 8 (entry-point thật AppModule+supertest, own-only/403/cross-tenant 404/no-mutation/empty-balance/holiday-weekend). Verify lane mediaos_leavebe1: leave 206 PASS · full 3596 PASS/0 fail · typecheck+build green. FULL gate PASS (security PASS 0-CRIT, completion 93/100). FOLLOW-UP (không chặn, dọn ở BE-2): LeaveService.listTypes/toTypeDto mồ côi sau re-point + resolveEmployeeByUserIdTx round-trip bỏ kết quả; is_enough chưa trừ reserved/pending (BE-2 validate cuối). Verify cuối + merge ở wave-PR.
    status: "done",
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
    // DONE 2026-06-27 (feat/s3-wave1, 15476a7): 6 route self-service. POST /leave/requests (draft, repoint legacy, submitNow chạy submit in-tx) · PATCH /:id (Draft-only→409) · POST /:id/submit (Draft→Pending) · POST /:id/cancel (cancel-own re-gate, Draft|Pending→Cancelled) · GET /leave/me/requests + /:id (own, 404 not-owner). FSM TitleCase. Submit: FOR UPDATE re-read + min-notice (company tz) + OVERLAP 422 LEAVE-ERR-REQUEST-OVERLAP (user_id, status Pending/Approved + lowercase, range intersect, exclude self+terminal; báo conflict id+dates) + balance (available=remaining-pending nếu !allowNegative→422) + RESERVE leave_balance_transactions (UPPERCASE) + pending_days += (KHÔNG chạm remaining GENERATED/used) + approval SUBMIT + audit objectType='leave_request' + outbox leave.request.submitted — TẤT CẢ 1 tx. Cancel: RELEASE tx + pending -= + approval CANCEL + event. employee_profiles BẮT BUỘC (422 LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE). leave_request_days (day_type có SPACE) replace mỗi create/update/submit. NO migration (audit 'leave_request' đã trong CHECK). Files mới leave-request.{service(748)/repository/logic/mappers}.ts (<800). TDD: 14 int (AppModule+supertest+Postgres thật) + append-only deny qua leave-ledger-appendonly.int-spec. Verify lane mediaos_leavebe2: leave 220 PASS · full 3610 PASS/0 fail · typecheck+build green. FULL gate PASS (security PASS 0-CRIT/0-HIGH, completion 93/100). FOLLOW-UP (không chặn): [MEDIUM] TOCTOU pending_days — balance read chưa FOR UPDATE, 2 submit song song cùng user/balance có thể over-reserve (sửa ở BE-3 cùng balance row-lock approve→USE); test dùng ngày cứng 2026 (time-bomb min-notice — neo today+offset); max_days/hours_per_request chưa validate; require_attachment defer (upload BE); approver routing defer→BE-3. Verify cuối + merge ở wave-PR.
    status: "done",
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
    status: "done",
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
    status: "done",
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
      "CRUD leave types + leave policies (HR); permission pair THẬT (leave-permissions.const.ts, KHÔNG hard-code mã người-đọc): (create|update|delete,'leave-type') + (view|create|update|delete,'leave-policy'); soft-delete KHÔNG hard-delete; audit thao tác",
      "HR view balances theo scope + adjust balance qua cặp (adjust,'leave-balance') — KHÔNG sửa số dư nếu KHÔNG tạo leave_balance_transactions (ledger, migration 0453 chỉ GRANT SELECT,INSERT app role — append-only); balance KHÔNG âm nếu allow_negative_balance=false (transaction + SELECT...FOR UPDATE row-lock chống race); balance_before/balance_after ledger liên tục khớp tail; audit_logs ghi khi adjust (DoD §16.3)",
      "deny-path RED viết-TRƯỚC: thiếu adjust:leave-balance → 403 + 0 ledger row; thiếu create/update/delete:leave-type hoặc :leave-policy → 403; 2-tenant deny (adjust/view balance nhân viên công ty khác → 403/404); append-only: app role UPDATE/DELETE leave_balance_transactions PHẢI fail; âm-số-dư: vượt số dư khi allow_negative_balance=false → reject + concurrency test; đổi số dư KHÔNG insert ledger row → không thể xảy ra (test qua repository trực tiếp)",
      "phần admin UI nâng cao = carry-over CO-S4-008; migration mới (nếu cần cột) PHẢI tạo RLS policy + FORCE TRƯỚC backfill; bảng đã có từ 0453 — xác nhận rõ trong plan có/không cần migration mới",
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
    status: "done",
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
      "onLeaveCancelled/onLeaveRevoked cho đơn ĐÃ Approved+đã sync: recalc attendance_records (gỡ Leave, khôi phục required minutes về shift/rule hiệu lực, tính lại late/early/missing nếu có check-in) + release/restore balance ĐÚNG SỐ; IDEMPOTENT (retry KHÔNG hoàn phép 2 lần — idempotency key / kiểm sync state) — S3-SYNC-004; FSM CANCEL chỉ owner (self) gọi được, REVOKE chỉ manager|HR (action REVOKE)",
      "deny-path RED viết-TRƯỚC (CHỐT 2026-07-02, bổ sung sau plan_block): actor KHÔNG phải owner gọi CANCEL → 403 + KHÔNG đổi status/KHÔNG refund/KHÔNG phát revert-event; actor KHÔNG phải manager|HR gọi REVOKE → 403 tương tự; POST /internal/v1/attendance/recalculate không auth / thiếu manage:attendance / thiếu internal-guard → 403, KHÔNG reprocess; full-day leave date → check-in/out disabled + status Leave trong bảng công; sync fail → trạng thái lưu + log; cross-tenant KHÔNG sync chéo; FULL gate (crown) + người chốt; coverage ≥80%",
      "AUDIT (CHỐT 2026-07-02): mọi attendance_record do sync/revert tạo/sửa/gỡ PHẢI append audit_logs (object_type=attendance_record) TRONG cùng tx app-pool — test khẳng định audit row tồn tại + rollback ⇒ không audit-ma",
    ],
  },

  // ── Frontend (registry → ATT pages → LEAVE pages) ──
  {
    id: "S3-FE-REGISTRY-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE registry + API layer ATT/LEAVE: app/sidebar/route registry (permission-driven) + attendanceApi/leaveApi + query-key factory + mutation invalidation matrix",
    zone: "red",
    status: "done",
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
      "SỬA PAIR-DRIFT (crown, bài học S1-FND-MODULE): PERMISSION_CODE_TO_PAIR (packages/web-core/src/lib/registry.ts ~L111-128) map ATT/LEAVE view codes sang cặp SEED THẬT (nguồn: apps/api/.../attendance-permissions.const.ts + leave-permissions.const.ts, mig 0454/0455), KHÔNG 'read:attendance'/'read:leave' (KHÔNG tồn tại trong catalog → hiện app ẩn với MỌI user). Map ĐÚNG: ATT.ATTENDANCE.VIEW_OWN→'view-own:attendance', VIEW_TEAM→'view-team:attendance', VIEW_COMPANY→'view-company:attendance'; LEAVE.REQUEST.VIEW_OWN→'view-own:leave', LEAVE.REQUEST.VIEW→'view:leave', LEAVE.REQUEST.APPROVE→'approve:leave' (giữ). MÔ HÌNH pair-as-gate: mỗi scope-level = cặp riêng (is_sensitive=true) mang data_scope riêng → cặp CHÍNH là cổng; requiredScopes chỉ defense-in-depth. Sửa comment L107-108 bỏ giả định sai 'VIEW_OWN/TEAM/COMPANY gộp cùng cặp đọc'",
      "EXPOSE cap nhạy cảm cho /auth/me (crown, RED-PATH apps/api/src/permission/permission.service.ts — cần security review): APPEND vào SENSITIVE_CAPABILITY_ALLOWLIST (L29) các cặp gate FE: 'view-own:attendance','view-team:attendance','view-company:attendance','view:leave' (view-own:leave/approve:leave đã non-sensitive → đã lộ). Lý do: cặp is_sensitive=true bị lọc khỏi /auth/me → thiếu → app/route ẩn với TẤT CẢ. CHỈ mở CỜ HIỂN THỊ (UI-hint capabilities), enforcement KHÔNG đổi (PermissionGuard trên controller vẫn cổng thật). GIỮ 'view:audit-log' đang có (APPEND, KHÔNG rewrite Set)",
      "SPEC KHÔNG XANH-GIẢ: registry.spec.ts:82-107 ('getVisibleApps 7 app cho company-admin') thay caps GIẢ read:attendance/read:leave bằng cặp company-admin THẬT (view-own/view-team/view-company:attendance + view-own:leave/view:leave/approve:leave) rồi VẪN khẳng định 7 app gồm attendance+leave. Pin theo const seed THẬT, KHÔNG mã FE (nếu không: ship với ATT/LEAVE ẩn ngoài đời mà test vẫn xanh)",
      "DENY-PATH TEST RED-TRƯỚC (BẮT BUỘC — cả packages/web-core registry.spec.ts LẪN apps/app/src/test/registry-guard.spec.tsx): (a) employee (chỉ view-own:attendance+view-own:leave, scope Own) → evaluateRouteAccess /attendance/team-records + /attendance/records(company) + /leave/approvals + /leave/calendar(team/company) = SHOW_403/404 VÀ filterSidebarItems ẨN các item Team/Company/approvals/calendar-team; (b) manager (view-team:attendance Team, KHÔNG view-company) → THẤY Team, KHÔNG Company; (c) hr/company-admin (view-company) → THẤY Company; (d) session.modules ĐƯỢC populate (active/inactive/hidden — modules:[] = xanh-giả) VÀ UserPermission.scopes populate THẬT (scopes:[] = xanh-giả)",
      "Route/sidebar metadata ATT/LEAVE (routes §8.8 /attendance/*, /leave/*) gate bằng requiredAny theo FE code đã map đúng cặp (VIEW_TEAM tự chặn employee vì KHÔNG có view-team:attendance) + requiredScopes:[Team]/[Company] giữ như defense-in-depth; app inactive/thiếu setting → ẩn; KHÔNG hard-code role",
      "attendanceApi + leaveApi service modules (web-core, typed apiFetch — KHÔNG nhận/forward company_id, KHÔNG đụng token-storage) + query-key factory ATT/LEAVE APPEND key mới (KIỂM tên THẬT trong web-core trước — đã có myToday/mySummary/requests.detail/balances.my → thêm teamRecords/records.detail, KHÔNG rename key cũ) + mutation invalidation matrix (check-in/out → today+my-records; approve → list+detail+balance)",
      "DEFER chống scope-creep: /leave/calculate preview (chưa có contract @mediaos/contracts) → hoãn sang S3-FE-LEAVE-1; /leave/settings/policies giữ ModulePlaceholder (KHÔNG dựng leaveApi.policy ở WO này); web test registry+guard (web-core + apps/app) xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-ATT-1",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE ATT Today: AttendanceTodayPage + AttendanceStatusCard + CheckInOutActions + useAttendanceToday/useCheckIn/useCheckOut + disabled reason + invalidate + toast + state",
    zone: "green",
    status: "done",
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
    zone: "yellow",
    status: "done",
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
      "PIN CẶP SEED THẬT (spine S3-FE-REGISTRY-1 #59 ĐÃ MERGE — PERMISSION_CODE_TO_PAIR đã đúng view-*): menu/route ATT records gate qua FE code map đúng cặp view-team:attendance (Team) / view-company:attendance (Company) — KHÔNG tự chế mã 'ATT.RECORD.VIEW_TEAM'; requiredScopes chỉ defense-in-depth. useCan cho cặp NHẠY CẢM KHÔNG dựa wildcard (BE is_sensitive=true → không chấp *:*; FE fail-closed khớp BE, tránh FE-permit/BE-403)",
      "DENY-PATH TEST RED-TRƯỚC (nhân pattern apps/app/src/test/registry-guard.spec.tsx): (a) employee (chỉ view-own:attendance, scope Own) → route /attendance/team-records + /attendance/records(company) = SHOW_403/ForbiddenPage VÀ filterSidebarItems ẨN item Team/Company; (b) manager (view-team:attendance Team) → THẤY Team, KHÔNG Company; (c) session.modules ĐƯỢC populate (active/inactive/hidden — modules:[] = xanh-giả) + UserPermission.scopes populate THẬT (scopes:[] = xanh-giả)",
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
    status: "done",
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
    zone: "yellow",
    status: "done",
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
      "LeaveApprovalPage + pending request table (theo scope) + approval detail drawer/modal + approve/reject confirmation + reject reason textarea (bắt buộc khi reject); loading/empty/error/forbidden",
      "PIN CỔNG PHÂN 3 TẦNG (verified nguồn THẬT — leave.controller.ts + leave-permissions.const.ts + mig 0455, chống bẫy pair-drift S1-FND-MODULE FE-permit/BE-403): (i) route + sidebar entry + LIST-load LeaveApprovalPage gate = view:leave (BE GET /leave/requests gate view:leave, đã trong SENSITIVE_CAPABILITY_ALLOWLIST → lộ /auth/me) — KHÔNG phải approve:leave; (ii) nút approve = approve:leave (non-sensitive, đã lộ); (iii) nút reject = approve:leave Ở FE (UI-hint) — CỐ Ý vì reject:leave is_sensitive KHÔNG trong allowlist ⇒ useCan('reject:leave') LUÔN false; BE ép reject:leave fail-closed (leave.controller.ts). Ghi chú rõ đây là chủ ý, KHÔNG bỏ sót",
      "DENY-PATH TEST RED-TRƯỚC (nhân pattern apps/app/src/test/registry-guard.spec.tsx): (a) user thiếu view:leave → route/sidebar/list LeaveApprovalPage ẨN hoặc 403 mềm; (b) user thiếu approve:leave → nút approve/reject KHÔNG render (PermissionGate deny); (c) user CÓ approve:leave NHƯNG thiếu reject:leave → bấm reject nhận BE 403 → lỗi mềm, KHÔNG optimistic-apply, KHÔNG crash; (d) approve ngoài scope (manager duyệt đơn ngoài team) → 403 mềm; (e) session.modules + UserPermission.scopes populate THẬT — assert !== [] (chống xanh-giả)",
      "invalidate list + detail của trang approval sau approve/reject (BỎ 'balance' — approver KHÔNG giữ balance key của requester, invalidate balance là no-op; balance của requester tự cập nhật ở phiên họ)",
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

  // ════════════════════ CARRY-OVER — ATT/LEAVE P1/P2 (CO-S4 kéo lên, seed 2026-07-01 owner chốt) ════════════════════
  // Đối chiếu FRONTEND-09 (ATT 19 màn) + FRONTEND-10 (LEAVE 14 màn) vs P0-spine đã có (S3-FE-ATT-1/2, S3-FE-LEAVE-1/2).
  //   P0 spine PHỦ ĐỦ; đây là P1/P2 owner từng defer sang Sprint 4 (§21 CO-S4-003..008) — nay chốt kéo lên board.
  //   BE đã có (FE build được khi BE done): ATT records company (S3-ATT-BE-2 ✅) · shift/rule min (S3-ATT-BE-3 todo) ·
  //   LEAVE edit-draft (S3-LEAVE-BE-2 ✅) · all-requests+approval (S3-LEAVE-BE-3 todo) · types/policies/balances
  //   (S3-LEAVE-BE-4 todo). BE CHƯA có → seed mới: ATT adjustment (BE-4) · ATT remote-work (BE-5) · ATT reports+audit
  //   (BE-6) · LEAVE calendar (BE-5) · LEAVE reports/transactions/audit (BE-6).
  //   ⚠️ Doc gắn P0 cho ATT-009 (tạo điều chỉnh) + LEAVE calendar nhưng backlog defer — pull nay giải quyết lệch đó.
  //   BE adjustment/remote-work: bảng skeleton ĐÃ migrate 0452 — hoàn thiện cột + API (migration nối head nếu thiếu).

  // ── ATT carry-over ──
  {
    id: "S3-ATT-BE-4",
    module: "ATT",
    layer: "BE",
    title:
      "ATT Adjustment workflow API (CO-S4-003): adjustment_requests create/list/detail + approve/reject + direct-adjust + recalc attendance_records + audit + event (skeleton 0452 → hoàn thiện cột nếu thiếu)",
    zone: "red",
    status: "done",
    paths: [
      "apps/api/src/attendance/**",
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S3-ATT-BE-2", "S2-INT-2"],
    src: [
      "IMPLEMENTATION-06 §21 (CO-S4-003)",
      "FRONTEND-09 §7 (UI-ATT-SCREEN-006..010)",
      "API-04",
      "SPEC-04",
    ],
    done_when: [
      "POST /attendance/adjustment-requests (create Own) + GET my + GET list (scope Team/Company) + GET :id + POST :id/approve + :id/reject(reason); state-machine + row-lock chống double-approve; approve → recalc attendance_records (giữ log, không mất dữ liệu); direct-adjust ATT.ATTENDANCE.ADJUST_DIRECT",
      "hoàn thiện shape adjustment_requests (migration NỐI TIẾP head nếu skeleton 0452 thiếu cột; RLS+FORCE đã có); audit + event mỗi action; balance/attendance mutation trong tx nhất quán",
      "deny-path RED viết-TRƯỚC: tạo hộ người khác → chặn; duyệt ngoài scope → 403; cross-tenant deny; FULL gate (workflow + attendance mutation) + người chốt",
    ],
  },
  {
    id: "S3-ATT-BE-5",
    module: "ATT",
    layer: "BE",
    title:
      "ATT Remote/Onsite-work request workflow API (CO-S4-004): remote_work_requests create/list/detail + approve/reject + ảnh hưởng tính công + audit + event (skeleton 0452 → hoàn thiện)",
    zone: "red",
    status: "done",
    paths: [
      "apps/api/src/attendance/**",
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S3-ATT-BE-2", "S2-INT-2"],
    src: [
      "IMPLEMENTATION-06 §21 (CO-S4-004)",
      "FRONTEND-09 §7 (UI-ATT-SCREEN-011..014)",
      "API-04",
      "SPEC-04",
    ],
    done_when: [
      "STATE-MACHINE (CHỐT LẠI 2026-07-02, owner override — GHI ĐÈ mọi bản done_when trước đó nói 'create → Pending'): create → **Draft** (KHÔNG Pending); action **submit** RIÊNG (Draft→Pending) trong contract/API — POST /attendance/remote-work-requests/:id/submit. Lúc submit: người tạo chọn current_approver_user_id là người duyệt TRỰC TIẾP HOẶC người duyệt THAY THẾ (delegate) + danh sách watcher_user_ids (theo dõi, nhận thông báo liên quan qua NOTI). Draft có thể sửa/xoá bởi chủ; chỉ request ở trạng thái Pending mới approve/reject được.",
      "POST /attendance/remote-work-requests (create Own → Draft) + GET my + GET list (scope) + GET :id + approve/reject/cancel-own; audit + event mỗi chuyển trạng thái (Draft→Pending qua submit, Pending→Approved/Rejected); Approved ảnh hưởng cách tính công ngày remote/công tác theo rule; Approved sinh/cập nhật attendance_records UPSERT-BY (company_id,employee_id,date) IDEMPOTENT — re-approve KHÔNG nhân đôi record",
      "hoàn thiện shape remote_work_requests (migration nối head nếu skeleton thiếu; RLS+FORCE); mutation trong tx; permission pair PIN đúng resource_type='remote-request' (seed 0454): create-own/view-own/view-team/view-company/cancel-own/approve/reject đều gate trên 'remote-request', reject dùng cặp reject:remote-request RIÊNG (không tái dùng approve)",
      "AUDIT object_type (CHỐT 2026-07-02): union-add 'remote_work_request' vào AUDIT_OBJECT_TYPES (apps/api/src/db/schema/audit.ts) + CHECK audit_logs CÙNG commit migration (mẫu UNION-ADD 0456)",
      "deny-path RED viết-TRƯỚC: tạo hộ người khác → chặn; submit hộ người khác / submit khi ≠Draft → chặn; approve/reject khi ≠Pending (vd còn Draft) → chặn; duyệt ngoài scope → 403; cross-tenant deny (gồm current_approver_user_id/watcher_user_ids PHẢI cùng company); cancel đơn người khác / cancel khi ≠Draft/Pending → chặn; FULL gate + người chốt",
    ],
  },
  {
    id: "S3-ATT-BE-6",
    module: "ATT",
    layer: "BE",
    title:
      "ATT Reports + audit read (CO-S4-006, P2): GET /attendance/reports (tổng hợp theo scope) + /attendance/audit-logs (tái dùng foundation audit filter module=ATT)",
    zone: "yellow",
    status: "done",
    paths: ["apps/api/src/attendance/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-ATT-BE-2", "S1-FND-AUDIT-1"],
    src: [
      "IMPLEMENTATION-06 §21 (CO-S4-006)",
      "FRONTEND-09 §7 (UI-ATT-SCREEN-018/019)",
      "API-04",
      "SPEC-04",
    ],
    done_when: [
      "GET /attendance/reports tổng hợp công theo scope Team/Company (present/late/missing/leave) + filter kỳ; permission pair THẬT (attendance-permissions.const.ts, KHÔNG mã người-đọc): (view-team,'attendance') + (view-company,'attendance'); report Team PHẢI giới hạn theo cây quản lý (DataScopeService/manager-tree, S2-INT-2) — KHÔNG phải mọi nhân viên công ty; report = 1 aggregate query group-by cố định (no N+1, khẳng định số query không đổi theo N record); trả tổng hợp có phân trang, KHÔNG kèm export CSV/stream (carry-over ngoài WO này)",
      "GET /attendance/audit-logs: TÁI DÙNG AuditRepository/AuditFilter (lọc module_code=ATT) nhưng route/controller/guard RIÊNG của ATT — KHÔNG dùng chung route/guard với foundation AuditController (cặp (view,'audit-log') của foundation KHÁC cặp ATT, tái dùng thẳng sẽ over-grant: ai có view audit-log foundation sẽ đọc được audit ATT). Gate bằng cặp (view,'attendance-audit-log'); dùng ĐÚNG masking layer của foundation audit read (audit_logs có thể chứa PII/salary ở old/new value)",
      "deny-path RED viết-TRƯỚC (BẮT BUỘC — plan trước bị BLOCK vì testTasks/steps rỗng): (a) GET /attendance/reports thiếu view-team/view-company:attendance → 403; (b) GET /attendance/audit-logs thiếu (view,attendance-audit-log) → 403; (c) 2-tenant: user tenant B gọi report/audit tenant A → 0 row/403; (d) manager scope Team chỉ thấy cây quản lý của mình, KHÔNG thấy team khác cùng công ty (IDOR); (e) append-only: không route UPDATE/DELETE trên audit; (f) grant foundation-audit (view,audit-log) KHÔNG mở được /attendance/audit-logs (test khẳng định KHÔNG over-grant); (g) 1 dòng audit chứa field nhạy cảm bị mask khi đọc qua /attendance/audit-logs",
      "PLAN BẮT BUỘC có micro-plan steps đầy đủ (route/guard pair/service scope/reuse foundation repo) TRƯỚC khi code — không được nộp steps rỗng lần nữa",
    ],
  },
  {
    id: "S3-FE-ATT-3",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE ATT Adjustment (/attendance/adjustment-requests my/list/new/:id + /records/:id/adjust): tạo/duyệt/điều chỉnh trực tiếp",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-ATT-BE-4", "S3-FE-ATT-2"],
    src: ["FRONTEND-09 §7 (UI-ATT-SCREEN-006..010)", "IMPLEMENTATION-06 §21 (CO-S4-003)", "UI-03"],
    done_when: [
      "/attendance/adjustment-requests/new (tạo, P0) + /my + list + /:id (detail/duyệt) + /records/:id/adjust (direct) nối API S3-ATT-BE-4; form RHF+Zod; PermissionGate ATT.ADJUSTMENT.* / ADJUST_DIRECT (cặp seed thật)",
      "approve/reject confirmation + reason; invalidate records/list/detail sau mutation; menu ẩn theo scope",
      "KHÔNG hard-code; loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-ATT-4",
    module: "FRONTEND",
    layer: "FE",
    title: "FE ATT Remote/Onsite (/attendance/remote-work-requests my/list/new/:id): tạo + duyệt",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-ATT-BE-5", "S3-FE-ATT-2"],
    src: ["FRONTEND-09 §7 (UI-ATT-SCREEN-011..014)", "IMPLEMENTATION-06 §21 (CO-S4-004)", "UI-03"],
    done_when: [
      "/attendance/remote-work-requests/new + /my + list + /:id (detail/duyệt) nối API S3-ATT-BE-5; PermissionGate ATT.REMOTE_REQUEST.*; approve/reject confirmation",
      "invalidate list/detail sau mutation; menu ẩn theo scope; KHÔNG hard-code",
      "loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-ATT-5",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE ATT admin + company records: /attendance/records (công ty, 004) + /attendance/shifts + /shift-assignments + /rules",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-ATT-BE-3", "S3-FE-ATT-2"],
    src: [
      "FRONTEND-09 §7 (UI-ATT-SCREEN-004/015/016/017)",
      "IMPLEMENTATION-06 §21 (CO-S4-007)",
      "UI-03",
    ],
    done_when: [
      "/attendance/records (bảng công công ty, Company scope) nối GET /attendance/records (S3-ATT-BE-2); filter/pagination; PermissionGate ATT.ATTENDANCE.VIEW_COMPANY",
      "/attendance/shifts + /shift-assignments + /rules: list + CRUD mức tối thiểu nối S3-ATT-BE-3; PermissionGate ATT.SHIFT.* / SHIFT_ASSIGNMENT.* / RULE.* (cặp seed thật); admin nâng cao = CO-S4-007 (giữ tối thiểu)",
      "KHÔNG hard-code; loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-ATT-6",
    module: "FRONTEND",
    layer: "FE",
    title: "FE ATT Reports (/attendance/reports) + Audit logs (/attendance/audit-logs)",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-ATT-BE-6", "S3-FE-ATT-2"],
    src: ["FRONTEND-09 §7 (UI-ATT-SCREEN-018/019)", "IMPLEMENTATION-06 §21 (CO-S4-006)", "UI-03"],
    done_when: [
      "/attendance/reports: bảng/biểu tổng hợp công theo scope nối GET /attendance/reports; filter kỳ; PermissionGate ATT.ATTENDANCE.VIEW_TEAM/COMPANY",
      "/attendance/audit-logs: bảng audit nối GET /attendance/audit-logs (foundation audit filter ATT); field mask do server; PermissionGate ATT.AUDIT_LOG.VIEW",
      "KHÔNG hard-code; loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },

  // ── LEAVE carry-over ──
  {
    id: "S3-LEAVE-BE-5",
    module: "LEAVE",
    layer: "BE",
    title:
      "LEAVE Calendar API (CO-S4-005): GET /leave/calendar theo data-scope Own/Team/Company (đơn Approved/Pending trong khoảng) + mask ngoài quyền",
    zone: "yellow",
    status: "done",
    paths: ["apps/api/src/leave/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-BE-3", "S2-INT-2"],
    src: [
      "IMPLEMENTATION-06 §21 (CO-S4-005)",
      "FRONTEND-10 §7 (UI-LEAVE-SCREEN-007/008/009)",
      "API-05",
      "SPEC-05",
    ],
    done_when: [
      "GET /leave/calendar?scope=own|team|company&from&to trả đơn nghỉ theo data-scope (tái dùng S2-INT-2 manager-tree); Own chỉ của mình, Team/Company theo quyền; permission LEAVE.CALENDAR.VIEW_OWN/TEAM/COMPANY",
      "KHÔNG lộ người ngoài scope; mask lý do nhạy cảm nếu thiếu quyền; no N+1",
      "deny-path RED: employee KHÔNG thấy calendar ngoài scope; cross-tenant deny; 403 khi thiếu quyền",
    ],
  },
  {
    id: "S3-LEAVE-BE-6",
    module: "LEAVE",
    layer: "BE",
    title:
      "LEAVE Reports + balance transactions + audit read (P2): GET /leave/balances/:id/transactions (ledger) + /leave/reports + /leave/audit-logs (foundation audit filter LEAVE)",
    zone: "yellow",
    status: "done",
    paths: ["apps/api/src/leave/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-BE-4", "S1-FND-AUDIT-1"],
    src: [
      "IMPLEMENTATION-06 §21 (CO-S4-006)",
      "FRONTEND-10 §7 (UI-LEAVE-SCREEN-014/014A/REPORT)",
      "API-05",
      "SPEC-05",
    ],
    done_when: [
      "GET /leave/balances/:id/transactions: ledger append-only theo scope (không sửa/xoá — BẤT BIẾN #2); permission LEAVE.BALANCE.TRANSACTION_VIEW",
      "GET /leave/reports tổng hợp nghỉ theo scope + filter kỳ; GET /leave/audit-logs = tái dùng foundation audit filter module_code=LEAVE (mask + append-only); permission LEAVE.REQUEST.EXPORT / LEAVE.AUDIT_LOG.VIEW",
      "deny-path RED: thiếu quyền → 403; 2-tenant deny; no-secret-log",
    ],
  },
  {
    id: "S3-FE-LEAVE-3",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE LEAVE all-requests (/leave/requests, 006) + edit draft (/leave/requests/:id/edit, 002E)",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-LEAVE-BE-3", "S3-FE-LEAVE-1"],
    src: ["FRONTEND-10 §7 (UI-LEAVE-SCREEN-006/002E)", "IMPLEMENTATION-06 §8.6", "UI-04"],
    done_when: [
      "/leave/requests (AllLeaveRequestsPage): list mọi đơn theo scope (Team/Dept/Company) nối GET /leave/requests; filter status/kỳ/phòng ban; PermissionGate LEAVE.REQUEST.VIEW",
      "/leave/requests/:id/edit (EditLeaveDraftPage): sửa đơn Draft nối PATCH /leave/requests/:id (Draft-only, S3-LEAVE-BE-2); dirty-form guard; PermissionGate LEAVE.REQUEST.UPDATE_DRAFT",
      "KHÔNG hard-code; loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-LEAVE-4",
    module: "FRONTEND",
    layer: "FE",
    title: "FE LEAVE Calendar (/leave/calendar, own/team/company theo scope)",
    zone: "yellow",
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-LEAVE-BE-5", "S3-FE-LEAVE-1"],
    src: [
      "FRONTEND-10 §7 (UI-LEAVE-SCREEN-007/008/009)",
      "IMPLEMENTATION-06 §21 (CO-S4-005)",
      "UI-04",
    ],
    done_when: [
      "/leave/calendar (LeaveCalendarPage): lịch nghỉ theo scope nối GET /leave/calendar; toggle own/team/company theo quyền; PermissionGate LEAVE.CALENDAR.VIEW_OWN/TEAM/COMPANY",
      "KHÔNG lộ người ngoài scope (server đã lọc); loading/empty/error/forbidden",
      "KHÔNG hard-code; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-LEAVE-5",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR) + /leave/balances/:id/transactions",
    zone: "yellow",
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-LEAVE-BE-4", "S3-LEAVE-BE-6", "S3-FE-LEAVE-1"],
    src: [
      "FRONTEND-10 §7 (UI-LEAVE-SCREEN-010/011/012/014)",
      "IMPLEMENTATION-06 §21 (CO-S4-008)",
      "UI-04",
    ],
    done_when: [
      "/leave/types + /leave/policies: list + CRUD nối S3-LEAVE-BE-4; PermissionGate LEAVE.TYPE.* / LEAVE.POLICY.* (cặp seed thật); soft-delete confirm",
      "/leave/balances (HR view theo scope) + /leave/balances/:id/transactions (ledger read-only): nối S3-LEAVE-BE-4/6; adjust balance qua ledger (PermissionGate LEAVE.BALANCE.ADJUST); KHÔNG sửa số dư ngoài ledger",
      "KHÔNG hard-code; loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },
  {
    id: "S3-FE-LEAVE-6",
    module: "FRONTEND",
    layer: "FE",
    title: "FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs)",
    zone: "yellow",
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S3-LEAVE-BE-6", "S3-FE-LEAVE-1"],
    src: [
      "FRONTEND-10 §7 (UI-LEAVE-SCREEN-REPORT/014A)",
      "IMPLEMENTATION-06 §21 (CO-S4-006)",
      "UI-04",
    ],
    done_when: [
      "/leave/reports: tổng hợp nghỉ theo scope nối GET /leave/reports; filter kỳ; PermissionGate LEAVE.REQUEST.EXPORT",
      "/leave/audit-logs: bảng audit nối GET /leave/audit-logs (foundation audit filter LEAVE); field mask do server; PermissionGate LEAVE.AUDIT_LOG.VIEW",
      "KHÔNG hard-code; loading/empty/error/forbidden; web test xanh; typecheck xanh",
    ],
  },

  // ════════════════════ CARRY-OVER — AUTH/ACCOUNT audit follow-ups (seed 2026-07-02) ════════════════════
  // Nguồn: audit 4-lớp AUTH/ACCOUNT vs DB-02 · BACKEND-03 · API-02 · FRONTEND-06 (memory auth-account-audit-2026-07).
  //   Kết quả: bất biến an ninh 100% PASS; gap THẬT chưa có WO nào cover được seed dưới đây.
  //   KHÔNG seed trùng việc đã có WO: /account/sessions = S2-FE-AUTH-5 (BE-7 done → tự ready) · role/permission
  //   admin FE = S2-FE-AUTH-4 · self-profile-edit = change-request (S2-FE-HR-4). Lệch-CÓ-CHỦ-ĐÍCH (uniform 401,
  //   cặp engine action:resourceType, change-password revoke-all, SSO 3-app redirect, 2FA đã ship, companySlug,
  //   refresh_tokens family model) → S2-AUTH-DOC-1 pin vào docs, KHÔNG "sửa" code theo doc cũ.
  //   Ưu tiên P1, KHÔNG chặn Sprint 3 spine; BE-8/9/10 + DB-3 là auth crown → FULL gate + người chốt.
  {
    id: "S2-AUTH-BE-8",
    module: "AUTH",
    layer: "BE",
    title:
      "user_security_events WRITER (audit gap #1): ghi sự kiện bảo mật BACKEND-03 §22.2 vào bảng user_security_events — viewer /auth/security-events hết rỗng-vĩnh-viễn",
    zone: "red",
    // AUDIT 2026-07-02: bảng + RLS + append-only + viewer API + FE page ĐỦ cả, nhưng grep toàn src KHÔNG có
    //   insert(userSecurityEvents) nào → màn Security events trống vĩnh viễn trong prod. Sự kiện hiện rải ở
    //   audit_logs (auth.password_changed/token_reuse_detected/session_revoked/user.locked…) + security_alerts.
    //   GIỮ audit_logs như cũ (append-only, không di trú lịch sử) — WO này THÊM writer song song, không thay thế.
    status: "todo",
    paths: [
      "apps/api/src/auth/**",
      "apps/api/src/users/**",
      "apps/api/src/permission/**",
      "packages/contracts/src/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit AUTH/ACCOUNT 2026-07-02 (HIGH #1: no writer)",
      "BACKEND-03 §22.2",
      "DB-02 §7.9 (user_security_events)",
      "SPEC-02",
    ],
    done_when: [
      "SecurityEventWriter (service dùng chung) ghi user_security_events TRONG CÙNG tx withTenant với mutation gốc, tối thiểu các event §22.2 đã có điểm phát: PASSWORD_CHANGED · PASSWORD_RESET · PASSWORD_RESET_REQUESTED · REFRESH_TOKEN_REUSE_DETECTED · SESSION_REVOKED (self-service + logout) · USER_LOCKED/UNLOCKED · ROLE_ASSIGNED/REVOKED · TOTP enable/disable; severity map theo contracts AUTH_AUDIT_LOG",
      "payload jsonb KHÔNG chứa secret/token/hash (đi qua masking allowlist như audit masker); company_id + user_id đúng tenant; KHÔNG đổi shape bảng (đã chuẩn ~95% DB-02 — không migration trừ khi thiếu enum event_type)",
      "GIỮ append-only: chỉ INSERT (grant hiện có SELECT,INSERT — không xin thêm); audit_logs hiện hữu GIỮ NGUYÊN (dual-write, không bỏ nguồn cũ)",
      "deny-path/RED viết-TRƯỚC: mutation gốc rollback ⇒ event rollback CÙNG tx (không event mồ côi); event không lộ secret; viewer /auth/security-events trả được event mới ghi (end-to-end hết rỗng); 2-tenant deny",
      "FULL gate (auth crown — security-reviewer) + người chốt; regression auth suite xanh trên LANE_DB cô lập",
    ],
  },
  {
    id: "S2-AUTH-BE-9",
    module: "AUTH",
    layer: "BE",
    title:
      "Lock/suspend user → REVOKE toàn bộ session/refresh NGAY (audit gap #2): đóng cửa sổ access-token ≤15' sau khi khóa",
    zone: "red",
    // AUDIT 2026-07-02 (HIGH #2): lockUser chỉ set status + audit (auth-users.service.ts:173-191) — KHÔNG đụng
    //   user_sessions/refresh_tokens; user bị khóa vẫn dùng API bằng access token còn hạn, chỉ bị chặn ở refresh kế.
    //   BACKEND-03 §10.4 + API-02 §18.8 yêu cầu revoke ngay khi lock. ⚠️ HAI surface song song cùng chức năng
    //   (bẫy S2-INT-1): /auth/users/:id/lock (locked) VÀ /users/admin/:id/suspend (suspended) — vá CẢ HAI.
    status: "todo",
    paths: ["apps/api/src/users/**", "apps/api/src/auth/**", "apps/api/test/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit AUTH/ACCOUNT 2026-07-02 (HIGH #2: lock-no-revoke)",
      "BACKEND-03 §10.4/§35",
      "API-02 AUTH-API-105 + §18.8",
      "memory s2-int1-shipped (TWO routes trap)",
    ],
    done_when: [
      "lockUser (POST /auth/users/:id/lock) VÀ suspend (POST /users/admin/:id/suspend): trong CÙNG tx set status → revoke MỌI refresh_tokens family + user_sessions active của target; tái dùng helper revoke sẵn có của auth.service (KHÔNG viết lại logic revoke)",
      "audit user.locked/suspended ghi kèm revoked_session_count; unlock/reactivate KHÔNG tự hồi phiên cũ (user login lại)",
      "deny-path/RED viết-TRƯỚC: sau lock → refresh token cũ 401 NGAY (không đợi reuse-detection) + session list của target rỗng/revoked; self-lock guard giữ nguyên; cross-tenant deny; 403 khi thiếu lock:user",
      "access token còn sống: ghi nhận giới hạn JWT stateless (chặn hoàn toàn cần denylist jti — NGOÀI scope, ghi note nếu không làm); FULL gate + người chốt",
    ],
  },
  {
    id: "S2-AUTH-BE-10",
    module: "AUTH",
    layer: "BE",
    title:
      "refresh() kiểm company active (audit gap #3): company suspended → KHÔNG cấp access token mới (chặn cửa sổ 30 ngày)",
    zone: "red",
    // AUDIT 2026-07-02 (MEDIUM-HIGH): refresh() check user active nhưng KHÔNG đọc companies.status — company bị
    //   suspend thì user còn refresh token vẫn xin token mới tới hết TTL 30d. BACKEND-03 §14.2 bước 6. Login đã
    //   check qua resolveCompanyId (mig 0430 allow-list 'active') — tái dùng cùng semantics, đừng chế mới.
    status: "todo",
    paths: ["apps/api/src/auth/**", "apps/api/test/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit AUTH/ACCOUNT 2026-07-02 (gap #3)",
      "BACKEND-03 §14.2 (b6)",
      "mig 0002 companies_status_chk ('active','suspended' CHỮ THƯỜNG)",
    ],
    done_when: [
      "refresh(): sau check user active, đọc companies.status — ≠'active' → 401 + thu hồi family (mirror nhánh user-không-active :635-651) + audit auth.refresh_blocked reason=company_inactive",
      "2FA challenge-verify + mọi đường cấp-token khác cũng qua cùng check (không chỉ 1 nhánh); KHÔNG đổi hành vi login (đã check)",
      "deny-path/RED viết-TRƯỚC: company suspended → refresh 401 + family revoked; company active → refresh bình thường (regression); test trên LANE_DB cô lập",
      "FULL gate (auth crown) + người chốt",
    ],
  },
  {
    id: "S2-AUTH-CAP-1",
    module: "AUTH",
    layer: "BE",
    title:
      "Phơi capability sensitive qua /auth/me: thêm export:leave + view:leave-audit-log + view:attendance-audit-log vào SENSITIVE_CAPABILITY_ALLOWLIST — mở khóa S3-FE-LEAVE-6 + sửa bug ngầm trang ATT audit-logs",
    zone: "red",
    // OWNER CHỐT 2026-07-03 (Cian, qua plan-review S3-FE-LEAVE-6 wave-1b): getCapabilities() lọc bỏ cặp
    //   is_sensitive không nằm trong allowlist → FE front-gate (useCanExact) chết cho MỌI user ở prod dù
    //   unit test xanh (setCaps() không đi qua allowlist thật). Đây là phơi CỜ hiển thị — server vẫn tự
    //   check permission ở mọi API, KHÔNG nới quyền thực tế.
    status: "todo",
    paths: ["apps/api/src/permission/**", "apps/api/src/auth/**"],
    skills: ["code-review"],
    depends_on: [],
    src: ["plan-review S3-FE-LEAVE-6 wave-1b 2026-07-02", "owner-decision 2026-07-03"],
    done_when: [
      "SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts) thêm APPEND-ONLY 3 cặp: export:leave · view:leave-audit-log · view:attendance-audit-log; KHÔNG đổi can()/PermissionGuard/data-scope",
      "int-spec colocated: role giữ grant (seed 0454/0455) nhận đủ 3 cặp qua /auth/me; user không grant → không thấy; 2-tenant deny giữ nguyên",
      "KHÔNG migration/đổi seed; regression permission + auth suite xanh LANE_DB cô lập",
      "FULL gate (security-reviewer — permission crown) + người chốt",
    ],
  },
  {
    id: "S2-AUTH-DB-4",
    module: "AUTH",
    layer: "DB",
    title:
      "2FA per-user + pair reset-2fa:user (OWNER CHỐT 2026-07-03): cột users.require_two_factor + seed permission reset-2fa:user grant company-admin",
    zone: "red",
    // OWNER CHỐT 2026-07-03 (Cian): ép 2FA = role (hiện có) + ĐÍCH DANH tài khoản (cờ mới, OR);
    //   admin được reset 2FA cho user (mất điện thoại) qua pair riêng reset-2fa:user (is_sensitive).
    status: "todo",
    paths: ["apps/api/migrations/**", "apps/api/src/db/schema/**"],
    skills: ["code-review"],
    depends_on: [],
    src: ["owner-decision 2026-07-03", "mig 0120 (roles.requires_two_factor)"],
    done_when: [
      "Migration 0466 (đánh số tiếp head 0465, additive): ALTER users ADD require_two_factor boolean NOT NULL DEFAULT false; KHÔNG đổi RLS (users đã có)",
      "Seed permission catalog UNION: pair (reset-2fa, user) is_sensitive=true + grant company-admin Company-scope, ON CONFLICT DO NOTHING idempotent + fail-loud check (mẫu mig 0120)",
      "Drizzle schema users additive cột mới; schema/index giữ khối additive; suite api xanh LANE_DB cô lập",
      "FULL gate (database-reviewer + security-reviewer) + người chốt",
    ],
  },
  {
    id: "S2-AUTH-BE-11",
    module: "AUTH",
    layer: "BE",
    title:
      "2FA self-service hardening + role-write cờ ép: status trả required · disable chặn khi bị ép (409) · POST/PATCH /auth/roles nhận requiresTwoFactor",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/auth/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-DB-4"],
    src: ["owner-decision 2026-07-03"],
    done_when: [
      "requiresTwoFactorTx = role-flag OR users.require_two_factor (cột 0466); /auth/2fa/status trả thêm required (additive contract)",
      "/auth/2fa/disable: user đang bị ép (role HOẶC per-user) → 409, KHÔNG tắt; audit + security event TOTP_DISABLED chỉ khi disable thành công",
      "POST/PATCH /auth/roles nhận requiresTwoFactor optional (CHỈ role thường — system role giữ rule cấm sửa của BE-6); audit role diff cờ; contracts RoleDto + requests additive",
      "deny-path RED-trước: bị ép → disable 409; system role toggle → 4xx; regression auth suite LANE_DB; FULL gate + người chốt",
    ],
  },
  {
    id: "S2-AUTH-BE-12",
    module: "AUTH",
    layer: "BE",
    title:
      "Admin 2FA controls: PATCH user requireTwoFactor + detail DTO twoFactor{enabled,requiredByRole,requiredByUser} + POST /auth/users/:id/2fa/reset (revoke sessions + audit + security event)",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/users/**",
      "apps/api/src/auth/**",
      "apps/api/src/permission/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-DB-4", "S2-AUTH-BE-11"],
    src: ["owner-decision 2026-07-03"],
    done_when: [
      "PATCH /auth/users/:id nhận requireTwoFactor (gate update:user hiện có) + audit user.updated diff; GET detail trả twoFactor {enabled, requiredByRole, requiredByUser} (additive)",
      "POST /auth/users/:id/2fa/reset gate pair MỚI reset-2fa:user (seed 0466): xoá user_totp + user_recovery_codes trong tx + revoke MỌI session/refresh (tái dùng revokeAllForUserTx) + audit user.2fa_reset + security event additive; self-reset CHO PHÉP (không lockout — user vẫn login được, bị ép enroll lại nếu required)",
      "SENSITIVE_CAPABILITY_ALLOWLIST append reset-2fa:user (FE cần front-gate nút Reset — bài học lớp-3 pair-drift) + int-spec /auth/me phơi pair cho company-admin",
      "deny-path RED-trước: thiếu pair → 403; cross-tenant → 404; sau reset: login không còn challenge + mustSetupTwoFactor=true nếu required + phiên cũ 401; FULL gate + người chốt",
    ],
  },
  {
    id: "S2-FE-ACCT-SEC-1",
    module: "AUTH",
    layer: "FE",
    title:
      "FE Account Security: section Bảo mật trong /account/profile — trạng thái 2FA + bật (→ /account/setup-2fa) + tắt (dialog mật khẩu, ẨN khi bị ép)",
    zone: "yellow",
    // SHIPPED 2026-07-04 qua PR #114 (merged vào feat/debt-wave2). LIGHT gate PASS (Đội3 ~92).
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-BE-11"],
    src: ["owner-decision 2026-07-03"],
    done_when: [
      "AccountProfilePage thêm card Bảo mật: twoFactorApi.status → enabled/required; chưa bật → nút 'Bật 2FA' link /account/setup-2fa (trang enroll dùng chung — voluntary vào trực tiếp được); required hiển thị nhãn 'bắt buộc theo chính sách'",
      "Tắt 2FA: dialog nhập mật khẩu → twoFactorApi.disable; nút ẨN khi status.required=true; lỗi 409 → thông báo rõ; KHÔNG ghi mật khẩu/recovery vào storage/console (BẤT BIẾN #3)",
      "test-first colocated: required → không thấy nút tắt; disable 409 → message; chưa bật → thấy nút bật; loading/error/empty; web test + typecheck xanh; LIGHT gate",
    ],
  },
  {
    id: "S2-FE-SYS-SEC-1",
    module: "AUTH",
    layer: "FE",
    title:
      "FE Admin security: /system/roles form toggle 'Bắt buộc 2FA' + /system/users detail hiện 2FA (nguồn ép) + toggle ép tài khoản + nút Reset 2FA (PermissionGate reset-2fa:user)",
    zone: "yellow",
    // SHIPPED 2026-07-04 qua PR #115 (merged vào feat/debt-wave2). LIGHT gate PASS (typecheck+full suite+permission cross-check).
    status: "done",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["code-review"],
    depends_on: ["S2-AUTH-BE-11", "S2-AUTH-BE-12"],
    src: ["owner-decision 2026-07-03"],
    done_when: [
      "RoleFormPage (create/edit role thường): switch requiresTwoFactor nối role write API; system role read-only giữ nguyên",
      "UserDetailPage: khối 2FA hiện enabled + nguồn ép (role/tài khoản); toggle 'Ép 2FA tài khoản này' (PATCH requireTwoFactor, gate update:user); nút 'Reset 2FA' confirm-dialog gate ĐÚNG pair reset-2fa:user (đã allowlist ở BE-12 — KHÔNG mượn pair khác), sau reset toast + refetch",
      "test-first colocated deny-path: không có reset-2fa:user → nút Reset ẨN; không update:user → toggle ẩn/disabled; pair pin theo seed thật; web test + typecheck xanh; LIGHT gate",
    ],
  },
  {
    id: "S2-AUTH-DB-3",
    module: "AUTH",
    layer: "DB",
    title:
      "user_roles soft-delete (audit gap #4): thêm deleted_at/deleted_by + REVOKE DELETE app-role — gỡ role không còn xóa cứng (DB-02 §4.9, BẤT BIẾN #2)",
    zone: "red",
    // AUDIT 2026-07-02 (HIGH #3 DB): app role có GRANT DELETE trên user_roles (mig 0005:142), bảng không có
    //   deleted_at — gỡ role = HARD DELETE, mất forensic trail bậc-1 RBAC. LANE NỐI TIẾP db-migration (không song
    //   song migration khác). ⚠️ ĐỔI READER TRƯỚC KHI SIẾT GRANT: permission.service/auth.service me()/mọi query
    //   user_roles phải filter deleted_at IS NULL, và code gỡ-role (permission-admin.service revoke) phải chuyển
    //   DELETE→UPDATE set deleted_at, RỒI migration mới REVOKE DELETE — sai thứ tự là vỡ runtime.
    // OWNER CHỐT 2026-07-03 (checkpoint feat/debt-wave2, sau plan-BLOCK round 1): plan-reviewer bắt hidden-writer
    //   super-admin-bootstrap.repository.ts:assignRole dùng raw `INSERT ... ON CONFLICT (user_id, role_id,
    //   company_id) DO NOTHING` trỏ ĐÚNG cột constraint user_roles_uq bị DROP trong WO này → sau migrate sẽ
    //   42P10 NGAY LÚC BOOT (bootstrap chạy mỗi lần khởi động). BẮT BUỘC: (1) đổi ON CONFLICT đó thành
    //   `(user_id, role_id, company_id) WHERE deleted_at IS NULL DO NOTHING` (khớp tiền lệ seeder att/hr/leave),
    //   sửa comment L155 (bỏ 'constraint user_roles_uq'); (2) deleteUserRole thêm param actorUserId, cập nhật
    //   CẢ HAI caller (revokeRole permission-admin.service.ts:163 VÀ nhánh reassign/đổi-expiry :110 — không chỉ
    //   revoke); (3) acceptance thêm grep toàn apps/api cho `ON CONFLICT (user_id` + mọi INSERT INTO user_roles
    //   khác phải kèm predicate deleted_at, xác nhận 0 site trần còn sót; (4) findUserIdsWithRole
    //   (permission-admin.repository.ts:199-205) lọc thêm deleted_at IS NULL cho nhất quán (không phải lỗ bảo
    //   mật, chỉ over-invalidate cache — vẫn nên sửa cùng đợt).
    // OWNER CHỐT round 2 (sau plan-BLOCK lần 2, round-1 fix ở trên ĐÃ ĐÚNG — giữ nguyên): 2 lỗi MỚI plan-reviewer
    //   bắt được, BẮT BUỘC sửa: (5) deleteUserRole (permission-admin.repository.ts:118) chuyển DELETE→UPDATE
    //   PHẢI có predicate `AND deleted_at IS NULL` trong WHERE — thiếu nó, chu kỳ grant→revoke→grant→revoke cùng
    //   (user,role,company) sẽ khiến UPDATE ghi đè deleted_at/deleted_by của TOMBSTONE CŨ (mất forensic, phá
    //   chính mục đích WO này); áp cho CẢ revokeRole (:163) VÀ nhánh reassign/đổi-expiry (:110); thêm regression
    //   khẳng định tombstone cũ KHÔNG đổi sau 1 chu kỳ re-grant+re-revoke tiếp theo. (6) THIẾU deny-path cho
    //   reader đặc quyền cao nhất `isOperatorTx` (auth.service.ts:1341-1356 — KHÔNG phải 'requiresTwoFactorTx'
    //   như nhãn sai trong plan round trước; requiresTwoFactor thật ở two-factor.service.ts:97 +
    //   auth-users.repository.ts:163): soft-delete assignment platform-admin PHẢI khiến login SAU ĐÓ không còn
    //   mint được token operator-plane (aud=tenant, isOperatorTx=false) — thêm int-spec bắt buộc. (7) Drizzle
    //   schema: CHỈ thêm 2 cột deletedAt/deletedBy (deletedBy .references(users.id,{onDelete:'set null'})) —
    //   TUYỆT ĐỐI KHÔNG mirror partial-unique bằng uniqueIndex() thật (drizzle không biểu diễn được partial →
    //   drizzle-kit coi là unique ĐẦY ĐỦ → drift, db:generate tương lai sinh migration thừa); partial unique CHỈ
    //   tồn tại ở SQL tay + comment, giống pattern roles.ts:27-29. (8) getObjectGrants nhánh role-subject
    //   (permission.repository.ts:111) thêm test: object grant (ALLOW/DENY) qua role KHÔNG còn hiệu lực sau khi
    //   user_role của role đó bị soft-delete.
    // OWNER CHỐT round 3 (sau plan-BLOCK lần 3, round 1+2 fix ở trên ĐÃ ĐÚNG — giữ nguyên): 2 lỗi MỚI, CẢ HAI BẮT
    //   BUỘC (không có gì cần chốt sản phẩm, thuần kỹ thuật): (9) `findUserRole` (permission-admin.repository.ts:66-84)
    //   THIẾU trong danh sách sửa — dùng làm idempotency-check trong assignRole (:97)/revokeRole (:159), KHÔNG lọc
    //   deleted_at ⇒ trả về TOMBSTONE sau soft-delete ⇒ (a) re-grant cùng expiry null bị NO-OP im lặng (return
    //   tombstone, KHÔNG insert row mới/audit/cache-invalidate — user không lấy lại được quyền dù API trả 200);
    //   (b) re-revoke role đã gỡ ghi audit RoleRevoked LẦN 2 (nhiễu forensic). SỬA: thêm `isNull(deletedAt)` vào
    //   findUserRole, đưa vào reader-list + acceptance grep; RED test BẮT BUỘC dùng CÙNG expiry (null cả hai) để
    //   chạm đúng nhánh sameExpiry lỗi (khác expiry sẽ pass-giả qua nhánh delete+insert khác). (10) Grant SAI hiện
    //   trạng — mig 0005 CHỈ cấp SELECT,INSERT,DELETE trên user_roles cho mediaos_app, KHÔNG có UPDATE (khác
    //   companies/users vốn có UPDATE từ 0002 → 0467 mới 'giữ' được; user_roles KHÔNG cùng tiền lệ). Migration
    //   PHẢI `GRANT UPDATE ON user_roles TO mediaos_app` (quyền MỚI, KHÔNG PHẢI 'giữ nguyên' như note round 1/2
    //   ghi nhầm) + REVOKE DELETE + giữ SELECT/INSERT; thêm DO-block fail-loud kiểu 0467 assert
    //   has_table_privilege(...,'UPDATE')=true và DELETE=false; thêm test DƯƠNG (soft-delete UPDATE thành công
    //   dưới role mediaos_app thật — không phải superuser, để bắt đúng thiếu-grant); cập nhật 2 comment stale
    //   (permission-admin.repository.ts:11-12, service.ts:108 'KHÔNG có UPDATE grant') thành đúng hiện trạng mới;
    //   sửa tham chiếu sai 'roles.ts:27-29' (file không tồn tại) → đúng là permissions.ts:27-29.
    // SHIPPED 2026-07-04 qua PR #111 (squash 1c4849c vào feat/debt-wave2, mig 0471): FULL gate security-reviewer
    //   + database-reviewer PASS, 0 finding chặn (2 LOW không chặn) sau đúng 3 vòng owner-chốt ở trên.
    status: "done",
    paths: [
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "apps/api/src/permission/**",
      "apps/api/src/auth/**",
      "apps/api/src/users/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit AUTH/ACCOUNT 2026-07-02 (HIGH: user_roles hard-delete)",
      "DB-02 §4.9/§7.4",
      "CLAUDE.md §2 (BẤT BIẾN #2)",
      "mig 0005 (GRANT DELETE user_roles)",
    ],
    done_when: [
      "migration NỐI TIẾP head: user_roles + deleted_at timestamptz NULL + deleted_by uuid FK SET NULL; UNIQUE (user_id,role_id,company_id) → partial WHERE deleted_at IS NULL (re-grant sau khi gỡ không vỡ unique); REVOKE DELETE ON user_roles FROM app-role (giữ SELECT,INSERT,UPDATE)",
      "MỌI reader user_roles filter deleted_at IS NULL (permission.service can/getCapabilities/getCapabilityScopes · auth.service me() · data-scope · users list roles nếu có) — grep khẳng định không sót; revoke-role (permission-admin) chuyển DELETE → UPDATE set deleted_at/deleted_by trong tx + audit như cũ",
      "RLS+FORCE giữ nguyên policy hiện có; RED test: app-role DELETE user_roles → DENIED; gỡ role → row còn (deleted_at set) + user MẤT quyền ngay (cache invalidate như cũ); re-assign lại role đã gỡ → OK không unique-vỡ",
      "verify chain migrate 0000→head trên LANE_DB cô lập + regression permission suite xanh; FULL gate (database-reviewer + security-reviewer) + người chốt",
    ],
  },
  {
    id: "S2-FE-AUTH-6",
    module: "FRONTEND",
    layer: "FE",
    title:
      "FE Account-layer còn thiếu: màn enroll 2FA trong apps/app khi mustSetupTwoFactor (BE đã enforce) + /account/profile (read) + sửa AvatarMenu trỏ đúng",
    zone: "yellow",
    // AUDIT 2026-07-02: BE TwoFactorEnforcementGuard đã chặn user bị ép 2FA chưa enroll, nhưng apps/app KHÔNG có
    //   màn enroll (chỉ console có TwoFactorSettings) → user kẹt không lối ra. /account/profile: ROUTE_REGISTRY có
    //   meta account.profile nhưng router chưa đăng ký; AvatarMenu "Tài khoản của tôi" đang trỏ /home.
    //   Self-EDIT hồ sơ vẫn = change-request workflow (S2-FE-HR-4) — màn này CHỈ read + link.
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**", "packages/ui/**"],
    skills: ["frontend-design", "code-review"],
    depends_on: ["S2-FE-AUTH-1"],
    src: [
      "audit AUTH/ACCOUNT 2026-07-02 (FE gaps)",
      "FRONTEND-06 §7.2 (UI-ACCOUNT-SCREEN-001)",
      "SPEC-02 (2FA)",
      "API-02 (/auth/2fa/*)",
      "memory admin-hr-fe-screen-wos-seeded (self-edit = change-request)",
    ],
    done_when: [
      "luồng enroll 2FA trong apps/app: mustSetupTwoFactor=true từ /auth/me → điều hướng màn enroll (QR otpauth + verify TOTP + recovery codes hiện 1 LẦN) nối POST /auth/2fa/enroll|enable; enroll xong → refetch /auth/me → vào app bình thường; user KHÔNG bị ép → không thấy màn này",
      "/account/profile (read-only): thông tin tài khoản từ /auth/me (user + employee + roles hiển thị, KHÔNG gọi API mới) + link 'đề nghị thay đổi hồ sơ' → /hr/me/change-request + link đổi mật khẩu + link /account/sessions; AvatarMenu 'Tài khoản của tôi' trỏ /account/profile (hết trỏ /home)",
      "recovery codes KHÔNG vào localStorage/console (BẤT BIẾN #3); KHÔNG hard-code quyền; loading/error/empty; web test xanh (gồm test: mustSetupTwoFactor → redirect enroll; không ép → không redirect); typecheck xanh",
    ],
  },
  {
    id: "S2-AUTH-DOC-1",
    module: "AUTH",
    layer: "DOC",
    title:
      "Pin lệch-có-chủ-đích vào docs AUTH (DB-02 · BACKEND-03 · API-02 · FRONTEND-06): code thắng ở các điểm đã chốt — chặn audit sau báo 'lệch' giả",
    zone: "green",
    status: "todo",
    paths: ["docs/DB/**", "docs/BACKEND/**", "docs/API Design/**", "docs/FRONTEND/**"],
    skills: [],
    depends_on: [],
    src: [
      "audit AUTH/ACCOUNT 2026-07-02 (danh sách lệch-có-chủ-đích — memory auth-account-audit-2026-07)",
      "SPEC-02",
    ],
    done_when: [
      "API-02 + BACKEND-03 cập nhật: uniform 401 login (bỏ 403 USER-LOCKED/INACTIVE phân biệt — anti-enumeration đã chốt) · cặp engine (action,resource_type) thay MODULE.RESOURCE.ACTION · companySlug bắt buộc · change-password thu hồi MỌI phiên (khớp SPEC-02 §14.5) · path thật /auth/refresh · /auth/sessions(+/:id/revoke,+/revoke-others) · bộ 2FA /auth/2fa/* + login response union twoFactorChallenge · refresh_tokens family model song song user_sessions",
      "FRONTEND-06 cập nhật: SSO 3-app redirect qua ?redirect + server allowlist /auth/redirect-allowed (thay returnUrl client-side) · change-password → logout cưỡng bức · self-profile-edit = change-request workflow · FE bỏ nhánh 403 'tài khoản khóa' ở login (dead code với uniform 401) hoặc ghi rõ chỉ dành cho 403 ACCESS_RESTRICTED (security policy)",
      "DB-02 ghi chú hiện trạng đã chốt: user_totp+user_recovery_codes thay user_mfa_methods · user_invites thay purpose ở password_reset_tokens · roles không role_code (name = code) · role_permissions effect ALLOW/DENY; OWNER CHỐT 1 QUYẾT ĐỊNH: data_scope 'Project' — widen CHECK trước Sprint TASK HAY pin 'TASK dùng project-membership, KHÔNG dùng data_scope Project' (engine + contracts hiện bỏ Project có chủ ý) — ghi kết luận vào DB-02 + DECISIONS nếu cần",
      "mỗi điểm pin ghi 1 dòng 'CHỐT <ngày>: code thắng, lý do' ngay tại mục liên quan (KHÔNG viết lại cả doc — sửa đúng chỗ, giữ cấu trúc); KHÔNG đổi hành vi code trong WO này",
    ],
  },

  // ════════════════════ CARRY-OVER — FOUNDATION/SYSTEM audit follow-ups (seed 2026-07-02) ════════════════════
  // Nguồn: audit 6-lane Foundation vs DB-08/09/10 · BACKEND-04/11/12 · API-09/10 · FRONTEND-13/05
  //   → báo cáo docs/_review/FOUNDATION-SYSTEM-AUDIT-2026-07-02.md (memory foundation-system-audit-2026-07).
  //   Bất biến 100% PASS (0 CRITICAL); WO dưới = 8 HIGH + cụm THIẾU chưa có WO nào cover.
  //   KHÔNG seed trùng: màn FE Sequences/Seeds = S2-FE-FND-5 (chờ S2-FND-BE-2 — audit thấy BE ĐÃ build, xem note
  //   tại WO) · retention GET/PATCH + file-access viewer = S2-FND-BE-3 (đã build phần lớn, note tại WO) ·
  //   user_roles hard-delete = S2-AUTH-DB-3. P0 = red-zone FULL gate + người chốt; migration lane NỐI TIẾP.
  //   Lệch-có-chủ-đích (tuple permission · single-tenant cắt multi-company+internal-REST · download 302 presigned ·
  //   PROTECTED_TABLES · is_paid_holiday · doc-drift DB-08↔DB-09 · path/method lệch nhỏ) → S2-FND-DOC-1 pin docs,
  //   KHÔNG "sửa" code theo doc cũ.
  {
    id: "S2-FND-BE-4",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "File-access hardening (audit H1+H2): FilePolicy fallback FAIL-CLOSED cho file gắn entity module chưa đăng ký resolver + download chặn Infected/Pending",
    zone: "red",
    // AUDIT 2026-07-02 (HIGH #1+#2): registry resolver RỖNG ở production (grep registerResolver chỉ có trong spec;
    //   file-policy.service.ts:154-161) ⇒ mọi file — kể cả gắn entity HR nhạy cảm — chỉ gate bằng fallback
    //   FOUNDATION.FILE.* mức company (trái BACKEND-11 §11.10 deny-by-default). Download/download-url KHÔNG kiểm
    //   scan_status/upload_status (files.service.ts:231-263) — file Infected/Pending vẫn presign; chỉ luồng link
    //   chặn Infected. Upload hiện chưa E2E (file không lên được 'Uploaded') → siết fail-closed KHÔNG phá luồng
    //   thật nào — verify bằng grep usage trước khi siết.
    status: "todo",
    paths: ["apps/api/src/foundation/files/**", "apps/api/test/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (H1/H2 — docs/_review/FOUNDATION-SYSTEM-AUDIT-2026-07-02.md §2)",
      "BACKEND-11 §11.2/§11.9/§11.10/§25.1",
      "BACKEND-04 §5.6 (file private by default)",
    ],
    done_when: [
      "FilePolicy fallback fail-closed: file CÓ file_links trỏ entity (module_code,entity_type) KHÔNG có resolver đăng ký → DENY (không rơi về FOUNDATION.FILE.* company-wide); file KHÔNG link (đứng một mình, foundation-owned) giữ gate FOUNDATION.FILE.* như hiện tại; mọi deny ghi file_access_logs (allow+deny như đang có)",
      "getDownloadUrl + download (302): upload_status !== 'Uploaded' HOẶC scan_status === 'Infected' → từ chối (404/409 theo convention lỗi hiện có), KHÔNG presign; luồng link giữ chặn Infected như cũ; view metadata KHÔNG bị siết (chỉ chặn lấy nội dung)",
      "deny-path RED viết-TRƯỚC: (a) file link entity HR + user chỉ có download:foundation-file → DENY + access-log deny; (b) file Infected/Pending → không presign; (c) regression: file foundation thuần + Uploaded + Clean/NotRequired vẫn tải bình thường; 2-tenant deny giữ nguyên",
      "FULL gate (security-reviewer — file access = crown) + người chốt; int-spec files/file-policy cập nhật, suite xanh LANE_DB cô lập",
    ],
  },
  {
    id: "S2-FND-BE-5",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Permission-surface reconcile (audit H4+H6): chốt cặp audit-log viewer (0435↔0340) + MODULE_APP_METADATA sang cặp canonical + chốt gate /settings/public",
    zone: "red",
    // AUDIT 2026-07-02 (HIGH #4+#6 + FE-lane): (1) AuditController gate view:audit-log (mig 0340, sensitive) nhưng
    //   seed Foundation + my-apps metadata dùng view:foundation-audit-log (0435:345) → user có cặp foundation THẤY
    //   app Audit mà API 403; export:foundation-audit-log orphan. Đúng lớp bẫy S1-FND-MODULE (pin 1 cặp!).
    //   (2) MODULE_APP_METADATA (module-app-metadata.ts:30-63) còn cặp legacy read:attendance/read:leave/read:user —
    //   KHÔNG grant cho 4 role canonical 0444 → my-apps ẨN app ATT/LEAVE/AUTH (tiềm ẩn: apps/app chưa consume
    //   my-apps; sẽ nổ khi chuyển sang). FE PERMISSION_CODE_TO_PAIR đã SẠCH (PR #59) — drift còn lại ở BE.
    //   (3) GET /foundation/settings/public gate view:foundation-setting nhưng doc = Authenticated → user thường
    //   không bootstrap được public settings (timezone/locale/file limits).
    // SHIPPED 2026-07-03 qua PR #109 (feat/debt-wave2, commit 695899e+a06c596): FULL gate PASS ~92 sau round-1
    //   chốt hướng (cấm @Public(), tách controller giữ JwtAuthGuard+CompanyGuard bỏ PermissionGuard per-method).
    status: "done",
    paths: [
      "apps/api/src/foundation/module-catalog/**",
      "apps/api/src/foundation/audit/**",
      "apps/api/src/foundation/settings/**",
      "apps/api/migrations/**",
      "docs/permission-matrix-spec.md",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (H4/H6 + §7.3)",
      "API-09 §6.3",
      "API-10 (AUD-008)",
      "memory s1-fnd-module-metadata-seed-drift (pin pair in spec)",
      "mig 0340 + 0435 + 0444",
    ],
    done_when: [
      "CHỐT (không còn 'đề xuất'): audit-log viewer dùng view:audit-log (mig 0340) làm gate DUY NHẤT — đã verify grant TƯỜNG MINH chỉ cho company-admin (0340:36-40), KHÔNG có role 'audit-viewer' riêng trong spec nên không mơ hồ; đổi my-apps metadata module-app-metadata.ts:37 sang cùng cặp; view/export:foundation-audit-log 0435 → deprecate có ghi chú (KHÔNG xoá row seed, giữ append-only) HOẶC alias-grant migration; pin kết luận vào docs/permission-matrix-spec.md + API-09",
      "MODULE_APP_METADATA: ATT/LEAVE/AUTH đổi requiredAnyPermissions sang cặp canonical ĐÃ grant role 0444 (view-own/team/company:attendance · view-own/view:leave · view:user/role) — đối chiếu TỪNG cặp với seed thật (grep migration), sửa comment 'đã VERIFY' sai; int-test my-apps: user role canonical (employee/manager/hr/company-admin) thấy ĐỦ app được cấp; FE web-core registry.ts:141-142 ĐÃ map view:user/view:role đúng canonical (verify 2026-07-03, không cần đổi FE)",
      "OWNER CHỐT /settings/public — CƠ CHẾ BẮT BUỘC (plan-BLOCK round 1 đã bác bỏ @Public()): KHÔNG được bỏ @RequirePermission mà giữ nguyên @UseGuards(PermissionGuard) cấp lớp trên SettingsController (fail-closed 403 khi thiếu metadata) VÀ TUYỆT ĐỐI KHÔNG dùng @Public() (bỏ luôn JwtAuthGuard → mất tenant-scoping, vi phạm BẤT BIẾN #1). Làm ĐÚNG 1 trong 2: (a) tách getPublic sang controller/route KHÔNG áp PermissionGuard cấp lớp (mẫu route change-password trong AuthController — vẫn còn JwtAuthGuard+CompanyGuard, chỉ bỏ permission-check), hoặc (b) gỡ class-level guard, áp @RequirePermission per-method cho resolve/patch, để getPublic không có decorator nhưng vẫn qua JwtAuthGuard. GIỮ nguyên lọc is_public && !is_sensitive + secret-drop setting-mask.ts (KHÔNG nới mask)",
      "deny-path RED viết-TRƯỚC bắt buộc cho /settings/public: (a) KHÔNG Bearer token → 401 (không phải 200/403); (b) user companyA chỉ nhận public settings companyA (chứng minh withTenant/companyId vẫn ép sau khi đổi gate); test đặt ở int-spec (LANE_DB), KHÔNG để .spec.ts colocated cho case cần guard+DB thật",
      "FULL gate (security-reviewer — permission surface) + người chốt; regression permission suite xanh",
    ],
  },
  {
    id: "S2-FND-BE-6",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Trả nợ audit CONFIG holiday (BE-6→BE-9, audit H5) + mở rộng audit-masker stems (otp/salary/health/id_card)",
    zone: "red",
    // AUDIT 2026-07-02 (HIGH #5): holidays.service.ts create/update/delete (:151-220) KHÔNG gọi AuditService —
    //   comment defer ':75-76' còn nguyên; nợ FOUNDATION-BE-6 → BE-9 chưa trả (memory foundation-be6-holiday-deferrals
    //   đã cập nhật hiện trạng). Kèm (BACKEND-11 §12.5): audit-masker.service.ts:33-41 thiếu stems otp ·
    //   salary_amount · personal_health_info; stem 'identitynumber' KHÔNG khớp biến thể 'id_card_number' — hiện dựa
    //   kỷ luật DTO-at-source (tiền lệ lọt: S2-HR-BE-2).
    // SHIPPED 2026-07-03 qua auto-loop checkpoint (feat/debt-wave2, commit 75236b1): Đội3 PASS vòng2 (~93) rồi
    //   người chốt duyệt trực tiếp (không PR riêng — commit nằm sẵn trên nhánh tích hợp). Stem 'salary' thu hẹp
    //   còn 'salaryamount' để KHÔNG che base_salary (tránh regression audit trail update-salary/S2-QA-1); verify
    //   employees-salary-sensitive.int-spec.ts 7/7 pass trên LANE_DB cô lập.
    status: "done",
    paths: [
      "apps/api/src/foundation/holidays/**",
      "apps/api/src/events/audit-masker.service.ts",
      "apps/api/src/db/schema/audit.ts",
      "apps/api/migrations/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (H5 + §5.2 masker)",
      "BACKEND-04 §17.4",
      "BACKEND-11 §12.5",
      "SPEC-01 §16.3 (audit hành động quan trọng)",
      "memory foundation-be6-holiday-deferrals",
    ],
    done_when: [
      "create/update/delete public-holiday ghi AuditService.record TRONG CÙNG tx withTenant (old/new/changed_fields auto-mask); object_type 'public_holiday' — nếu CHƯA có trong CHECK audit_logs.object_type → migration UNION add-only nối head (hot-file append, CLAUDE.md §9.3); gỡ comment defer ':75-76'",
      "audit-masker: thêm stems otp · salary (phủ salary_amount/salaryAmount) · health (personal_health_info) · idcard (phủ id_card_number/idCardNumber — normalize bỏ '_' trước khi so stem); unit test mask từng biến thể; KHÔNG nới lỏng stem hiện có",
      "deny-path RED viết-TRƯỚC: mutation holiday rollback → audit rollback CÙNG tx (0 row mồ côi); audit payload không lộ field nhạy cảm; regression holidays suite + audit-masker spec xanh",
      "FULL gate (audit = crown) + người chốt; verify trên LANE_DB cô lập (migration CHECK mới)",
    ],
  },
  {
    id: "S2-FND-DB-1",
    module: "FOUNDATION",
    layer: "DB",
    title:
      "REVOKE DELETE app-role trên companies + users (audit sát-HIGH, BẤT BIẾN #2): chặn hard-delete tenant gốc + tài khoản",
    zone: "red",
    // AUDIT 2026-07-02: mig 0002:34 GRANT SELECT,INSERT,UPDATE,DELETE ON companies TO mediaos_app (users tương tự
    //   band cũ) — app role hard-delete được company/user dù cả 2 bảng có deleted_at; trái DB-08 §8.1 rule 4.
    //   Mọi bảng foundation band 0431+ đều đã bỏ DELETE. (user_roles = S2-AUTH-DB-3 riêng — KHÔNG trùng.)
    //   LANE NỐI TIẾP db-migration. ⚠️ ĐỔI WRITER TRƯỚC KHI SIẾT GRANT (bài học S2-AUTH-DB-3): grep mọi .delete(
    //   trên companies/users → chuyển soft-delete TRƯỚC, RỒI migration REVOKE — sai thứ tự là vỡ runtime.
    // SHIPPED 2026-07-03 qua auto-loop checkpoint (feat/debt-wave2, commit 40acc91): migration 0467, FULL gate
    //   PASS, push thẳng nhánh tích hợp (không PR riêng — HEAD đã ở mergeBase lúc ship).
    status: "done",
    paths: [
      "apps/api/migrations/**",
      "apps/api/src/db/schema/**",
      "apps/api/src/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (§2 sát-HIGH + §3.1 companies)",
      "DB-08 §8.1 rule 4",
      "CLAUDE.md §2 (BẤT BIẾN #2)",
      "mig 0002 (grant companies)",
    ],
    done_when: [
      "grep toàn src khẳng định KHÔNG writer nào hard-DELETE companies/users (drizzle .delete(companies|users)) — nếu có → chuyển UPDATE set deleted_at trong tx TRƯỚC; test suite/seed dùng role owner/postgres KHÔNG bị ảnh hưởng (chỉ siết mediaos_app)",
      "migration NỐI TIẾP head: REVOKE DELETE ON companies, users FROM mediaos_app (GIỮ SELECT,INSERT,UPDATE); RED test: app-role DELETE companies/users → DENIED (mẫu append-only test hiện có)",
      "db:check chain 0000→head xanh trên LANE_DB cô lập + regression auth/hr suite xanh; FULL gate (database-reviewer + security-reviewer) + người chốt",
    ],
  },
  {
    id: "S2-FND-SEED-2",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Runtime seeder HR + Sequences (audit H7, DB-10 §14): job_levels 8 + contract_types 5 + employee_code_config EMP + sequence counter + SequenceService.ensureCounter — DB sạch tự sinh employee_code",
    zone: "yellow",
    // AUDIT 2026-07-02 (HIGH #7): sequence_counters KHÔNG được seed ở tầng nào (0434 chỉ DDL; không seeder; không
    //   POST API; ensureCounter có TYPE sequence.types.ts:71-81 nhưng KHÔNG method) → hr-write.service.ts:412-425
    //   throw trên DB sạch — smoke DB-10 §19.3 FAIL. HR master (job_levels/contract_types/employee_code_config) =
    //   0 seed (mig 0445:12-17 chủ đích dời runtime nhưng lane chưa làm). Mẫu sẵn: att/leave-master-data.seeder +
    //   registrar + SeedTracking checksum idempotent.
    status: "todo",
    paths: [
      "apps/api/src/employees/**",
      "apps/api/src/foundation/sequences/**",
      "apps/api/src/foundation/seed/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (H7 + §4.2)",
      "DB-10 §14.1/§19.3",
      "BACKEND-04 §11.5 rule 3 (ensureCounter)",
      "mẫu att-master-data.seeder.ts + leave-master-data.seeder.ts",
    ],
    done_when: [
      "seeder 'hr.master-data' đăng ký registry (mẫu att/leave): job_levels 8 + contract_types 5 + employee_code_config (prefix EMP, padding 4) — giá trị theo DB-10 §14.1, idempotent qua SeedTracking checksum, KHÔNG đụng row user đã sửa (checksum Skip/Update đúng semantics hiện có)",
      "SequenceService.ensureCounter(input) hiện thực theo type sẵn có (tạo-nếu-chưa-có trong tx, ON CONFLICT DO NOTHING, trả counter) — hr-write/consumer gọi ensureCounter thay vì để SequenceNotFoundError nổ 500; chốt 1 đường (ensure-on-use), seeder KHÔNG cần seed counter trùng cơ chế",
      "smoke DB-10 §19.3 pass: DB sạch → migrate → boot (seed runner chạy) → tạo employee → employee_code = EMP0001 (int-spec trên LANE_DB cô lập)",
      "LIGHT gate (typescript-reviewer + quality-gate) — không đổi permission/RLS; suite api xanh",
    ],
  },
  {
    id: "S2-FND-SEED-3",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Bootstrap dựng-từ-trống tự động (audit §4.2): seed default company idempotent (thay bước psql tay) + must_change_password cho super-admin bootstrap",
    zone: "red",
    // AUDIT 2026-07-02: default company = bước psql tay (scripts/windows/03-migrate.ps1:32-38);
    //   SuperAdminBootstrapService fail-fast khi company vắng (super-admin-bootstrap.service.ts:66-77) → dựng-từ-trống
    //   phải seed tay + restart. DB-10 §17.2 điểm 5: bootstrap admin phải must_change_password=true — grep 0 kết quả
    //   toàn repo (cột không tồn tại).
    // OWNER CHỐT 2026-07-03 (checkpoint feat/debt-wave2, sau plan-BLOCK round 1) — bake TRƯỚC khi build (SECURITY
    //   DEFINER hardening là BLOCKING, không phải tuỳ chọn): (1) `ensure_default_company` PHẢI có
    //   `REVOKE ALL ON FUNCTION ensure_default_company(...) FROM PUBLIC` TRƯỚC khi GRANT EXECUTE cho app role —
    //   thiếu dòng này, PUBLIC (mọi DB role) mặc định có EXECUTE ⇒ bất kỳ role nào cũng tạo được tenant-root.
    //   (2) PHẢI `SET search_path = pg_catalog` + fully-qualify `public.companies` trong thân hàm (chống
    //   search_path-injection leo thang quyền definer) — mirror ĐÚNG `resolve_company_by_slug` (mig 0002).
    //   (3) Thêm deny-path THẬT: 1 role KHÁC app (không phải mediaos_app) gọi EXECUTE ensure_default_company PHẢI
    //   bị permission-denied — không chỉ test positive 'app role EXECUTE được'. (4) BOOTSTRAP_COMPANY_LOCALE
    //   default ĐỔI THÀNH 'vi' (KHÔNG 'vi-VN') — cột companies.language có CHECK CHỈ nhận 'vi'/'en' (mig 0015/0360),
    //   insert 'vi-VN' sẽ THROW CHECK violation → sập boot dựng-từ-trống; xác nhận currency mặc định ∈
    //   {'VND','USD'} (companies_currency_check) và param→cột mapping ghi rõ trong task. (5) OWNER CHỐT N=1 guard:
    //   nếu ĐÃ CÓ BẤT KỲ company active nào (bất kể slug có khớp BOOTSTRAP_COMPANY_SLUG hay không) → KHÔNG tạo
    //   company mới, bỏ qua bước này êm (không sập boot) — bảo vệ N=1 kể cả khi config slug lệch/bị đổi giữa
    //   các lần deploy; thêm test kịch bản 'đã có company khác slug → không tạo thêm'. (6) Lane khai
    //   `auth.service.spec.ts` (colocated) + int-spec me-flag PHẢI thêm 'apps/api/src/auth/**' +
    //   'apps/api/test/**' vào paths (đang thiếu → guard-scope sẽ cảnh báo); xác nhận tên file int-spec không
    //   đụng int-spec khác cùng chạy trong WO. (7) Audit: `auth.super_admin_bootstrapped` hiện có ĐÃ ĐỦ ghi dấu
    //   company auto-create (không cần audit riêng — đây là 1 hành động bootstrap thống nhất).
    // OWNER CHỐT round 3 (sau 3 vòng Đội3 FAIL, exhausted maxReviewIterations) — LỖ CRITICAL đã tái hiện được
    //   THẬT (không phải giả định): `ensure_default_company` (SECURITY DEFINER) KHÔNG concurrency-safe — guard
    //   SELECT rồi INSERT chạy READ COMMITTED, KHÔNG lock. 2 instance API cùng boot lần đầu (kịch bản HA thật) có
    //   thể cả hai đều thấy 0 company active rồi cả hai INSERT (slug khác nhau) đều COMMIT ⇒ 2 company ACTIVE
    //   cùng lúc, vỡ N=1. Đã verify bằng test-lặp song song (27 lần, fail ~3.7%) VÀ trực tiếp ở tầng SQL (2
    //   session function-owner). BẮT BUỘC vá ở TẦNG PRODUCT (không phải test-only retry):
    //   (8) Thêm `CREATE UNIQUE INDEX uq_companies_single_active ON companies((true)) WHERE status='active' AND
    //   deleted_at IS NULL` — DB tự chặn CỨNG >1 company active bất kể đường code nào ghi, kể cả path tương lai
    //   chưa viết. Hàm ensure_default_company bắt lỗi unique-violation (23505) từ INSERT này → coi như 'company
    //   khác đã thắng race' → SELECT lại + return company đó (KHÔNG throw ra ngoài) — giữ đúng ngữ nghĩa
    //   idempotent kể cả dưới race thật. (9) Test 'idempotent' (DB10-TC-003, dòng ~207) phải DETERMINISTIC —
    //   dùng SELECT có tiebreaker `ORDER BY created_at ASC, id ASC` (không chỉ created_at) HOẶC bọc 2 lần gọi
    //   trong 1 phiên/tx snapshot cố định — pattern giống REPEATABLE-READ fix đã áp cho test 'create-from-empty'
    //   (FIX-1), MỞ RỘNG sang test idempotent (chưa được áp). (10) GỘP 2 file test gần-trùng
    //   apps/api/src/foundation/seed/ensure-default-company.int.spec.ts và
    //   apps/api/test/integration/foundation-seed3-ensure-company.int-spec.ts thành 1 file canonical (2 file chạy
    //   song song trên CÙNG bảng companies chính là nguyên nhân gây race giữa 2 suite) — xoá bloat + xoá nguồn
    //   race test-tự-gây. (11) BẮT BUỘC mở PR + chạy FULL gate (security-reviewer + database-reviewer) THẬT trên
    //   commit fix — vòng trước code còn nằm local trên feat/debt-wave2, chưa qua gate.
    // SHIPPED 2026-07-04 (commit fb318b5, feat/debt-wave2): design-correction unique-index→advisory-lock
    //   (round-3 owner-chốt sai, tự sửa lại sau khi test-lane phát hiện phá ~141 file 2-tenant). FULL gate
    //   security-reviewer + database-reviewer (2 review độc lập, tự chạy lại verify) PASS; 2 LOW đã fix.
    status: "done",
    paths: [
      "apps/api/src/permission/super-admin-bootstrap.service.ts",
      "apps/api/src/foundation/seed/**",
      "apps/api/src/auth/**",
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "apps/api/src/config/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (§4.2 seed data)",
      "DB-10 §17.1/§17.2",
      "memory super-admin-bootstrap-flaky-count (int-spec hiện có)",
    ],
    done_when: [
      "boot với DB trống-sau-migrate: company mặc định TỰ tạo idempotent (slug/name từ env BOOTSTRAP_COMPANY_* — có default; ON CONFLICT theo slug unique 0002) TRƯỚC SuperAdminBootstrap trong cùng bootstrap chain — hết fail-fast-rồi-restart; env thiếu → log hướng dẫn rõ, KHÔNG sập boot môi trường đã có company; ĐÃ CÓ company active khác slug → bỏ qua tạo mới (N=1 guard, xem note owner-chốt)",
      "migration NỐI TIẾP head: users.must_change_password boolean NOT NULL DEFAULT false; bootstrap admin set true; /auth/me expose mustChangePassword (ADDITIVE — mẫu S2-AUTH-BE-1); change-password thành công → clear flag trong cùng tx; FE enforcement (redirect ép đổi) = follow-up FE, ghi TODO rõ KHÔNG dựng nút chết",
      "deny-path RED viết-TRƯỚC: bootstrap idempotent (chạy 2 lần → 1 company, 1 admin, grant-count không phình — vá luôn kịch bản flaky memory nếu chạm); secret env KHÔNG log; audit auth.super_admin_bootstrapped giữ nguyên",
      "FULL gate (bootstrap/auth = crown) + người chốt; int-spec super-admin-bootstrap + smoke dựng-từ-trống xanh trên LANE_DB cô lập",
    ],
  },
  {
    id: "S2-FND-SEED-4",
    module: "FOUNDATION",
    layer: "DB",
    title:
      "Seed settings đủ theo DB-10 §11 (audit §4.2): bổ sung 9/14 system key + cơ chế company-defaults 12 key + chốt giá trị lệch (25MB vs 20 · 'vi' vs 'vi-VN')",
    zone: "yellow",
    // AUDIT 2026-07-02: system_settings seed 5/14 key (0435:311-324); company_settings 0/12; giá trị lệch doc:
    //   file.max_upload_size_mb=25 vs 20, default_locale='vi' vs 'vi-VN'; SETTING_DEFAULTS hard-code chỉ phủ 6 key
    //   (setting-defaults.ts:19-76) — attendance.*/leave.* defaults KHÔNG tồn tại. 3 nguồn (migration seed ·
    //   SETTING_DEFAULTS · doc) đang drift. Gate: diff chạm migration ⇒ FULL theo policy (zone giữ yellow — model).
    // OWNER CHỐT 2026-07-03 (checkpoint feat/debt-wave2, sau plan-BLOCK round 1) — bake TRƯỚC khi build:
    //   (1) `notification.in_app_enabled` bị DB-10 liệt kê ở CẢ §11.1 (system) LẪN §11.2 (company-default) —
    //   ĐÃ seed system-scope từ 0435, GIỮ NGUYÊN (system thắng). Acceptance '12 company-default key scope=default'
    //   CHỈ áp cho 11 key KHÔNG trùng system_settings; riêng notification.in_app_enabled assert scope='system'
    //   value=true (KHÔNG đòi scope='default' cho key này) — ghi rõ trong task để không đỏ-giả/xanh-giả. Ghi chú
    //   entry notification.in_app_enabled trong SETTING_DEFAULTS là fallback KHÔNG reachable trong thực tế.
    //   (2) Deny-path /resolve cần role VIEW-ONLY (có view:foundation-setting, KHÔNG có update) để exercise nhánh
    //   canSeeNonPublic=false — role seed sẵn (company-admin=cả 2, employee=không có view) không đủ. TẠO grant
    //   ad-hoc CHỈ TRONG test setup (insert permission grant cho 1 user test, KHÔNG thêm role canonical mới vào
    //   seed sản phẩm) để giữ catalog role sạch. (3) module_code cho 10 key mới: THEO ĐÚNG cột Module DB-10 §11.1
    //   (security.*=AUTH, file.default_visibility=FOUNDATION, notification.*=NOTI, dashboard.*=DASH,
    //   system.default_currency=SYSTEM) — KHÔNG blanket 'SYSTEM' cho tất cả (WO này CHÍNH LÀ để sửa deviation
    //   audit, không lặp lại shortcut). (4) 'đủ 14 key canonical Active' = 4 key §11.1 sẵn có + 10 key mới;
    //   file.allowed_mime_types (đã seed 0435) là key DÔI, KHÔNG tính vào 14 và KHÔNG bị xoá — presence-test
    //   không được assert 'CHỈ đúng 14 rows Active'.
    status: "todo",
    paths: [
      "apps/api/migrations/**",
      "apps/api/src/foundation/settings/setting-defaults.ts",
      "apps/api/test/**",
      "docs/DB/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: ["audit FOUNDATION 2026-07-02 (§4.2)", "DB-10 §11.1/§11.2", "DB-08 §8.3-8.4"],
    done_when: [
      "OWNER CHỐT giá trị lệch: file.max_upload_size_mb (20 doc vs 25 code) + default_locale ('vi-VN' doc vs 'vi' code — ảnh hưởng i18n key FE) — kết luận ghi vào DB-10 (1 dòng CHỐT) rồi seed theo; KHÔNG đổi ngầm giá trị đang chạy nếu chốt code-thắng",
      "migration seed NỐI TIẾP head bổ sung system key còn thiếu (security.* · notification.* · file.default_visibility · system.default_currency · dashboard.cache_*) ON CONFLICT DO NOTHING — key nào thuộc module CHƯA build (NOTI/DASH) vẫn seed được vì là config nền (theo DB-10), value_type/validation đúng DB-08 §8.3",
      "company 12 key: CHỐT 1 cơ chế — mở rộng SETTING_DEFAULTS (precedence default đã có, KHÔNG cần seed per-company) là mặc định đề xuất; nếu chọn seed per-company → qua runtime seeder registry (KHÔNG migration company-scoped, bài học 0445:14-18); setting-defaults.ts đồng bộ hết drift 3-nguồn (test đối chiếu key-list)",
      "int-spec resolve các key mới theo precedence; db:check chain xanh; FULL gate theo migration + quality-gate",
    ],
  },
  {
    id: "S3-LEAVE-SEED-2",
    module: "LEAVE",
    layer: "BE",
    title:
      "Leave types 8/8 + pin mã (audit §4.2, DB-10 §14.3): thêm MATERNITY/MARRIAGE/BEREAVEMENT/COMPENSATORY + chốt ANNUAL↔ANNUAL_LEAVE + allowHourly",
    zone: "yellow",
    // AUDIT 2026-07-02: leave-master-data.seeder.ts:55-99 seed 4/8 loại, mã KHÁC doc (ANNUAL vs ANNUAL_LEAVE...);
    //   ANNUAL allowHourly:false vs doc policy allow_hourly:true. Mã đã có dữ liệu tham chiếu (leave_requests) →
    //   ĐỔI MÃ = migration data, tránh nếu được. Pin mã TRƯỚC khi FE bind constants.
    status: "todo",
    paths: ["apps/api/src/leave/**", "packages/contracts/src/**", "apps/api/test/**", "docs/DB/**"],
    skills: ["code-review"],
    depends_on: ["S3-LEAVE-SEED-1"],
    src: ["audit FOUNDATION 2026-07-02 (§4.2)", "DB-10 §14.3", "SPEC-05"],
    done_when: [
      "OWNER CHỐT bộ mã leave type (đề xuất: code-thắng GIỮ ANNUAL/SICK/UNPAID/OTHER — ngắn, đã có dữ liệu; pin vào DB-10 §14.3 1 dòng CHỐT) + chốt ANNUAL allowHourly (doc true vs code false — ảnh hưởng FE form nghỉ theo giờ)",
      "seeder mở rộng thêm 4 loại MATERNITY/MARRIAGE/BEREAVEMENT/COMPENSATORY (thuộc tính paid/quota theo DB-10 §14.3) idempotent checksum; policy mặc định các loại mới nếu doc yêu cầu; KHÔNG đụng row đã sửa tay",
      "mã leave type expose qua packages/contracts constants (FE bind từ contracts, KHÔNG hard-code chuỗi); int-spec seeder xanh trên LANE_DB",
      "LIGHT gate; nếu chốt đổi-mã (không khuyến nghị) → nâng FULL + migration data + người chốt",
    ],
  },
  {
    id: "S2-FND-BE-8",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Đóng permission-seed orphan (audit §6.3): system-settings GET/PATCH + PATCH modules/:code toggle (audit CONFIG) + audit export + retention POST create/simulate + not-found guard",
    zone: "red",
    // AUDIT 2026-07-02: 7 cặp đã seed 0435 nhưng KHÔNG endpoint nào dùng → màn console admin không có BE:
    //   system-manage:foundation-setting (0435:343) · update:foundation-module (0435:339 — S2-FND-BE-1 đã note
    //   'toggle = follow-up crown/red') · export:foundation-audit-log (0435:346 — chờ chốt cặp ở S2-FND-BE-5) ·
    //   run:foundation-seed + view/run:foundation-job (job = S2-FND-JOBS-1). Retention: service CÓ createPolicy/
    //   simulate (retention.service.ts:90-129, 296-323) nhưng controller không expose; simulate/runCleanup thiếu
    //   guard policy-not-found → 500 thay 404 (:309-310, :350-351).
    // OWNER CHỐT 2026-07-04 (sau plan-BLOCK round 4, không có phản hồi trong 60s → tiến hành theo phương án
    //   khuyến nghị đã đề xuất): (1) audit-export DEFER — KHÔNG build route ở WO này; pin vào S2-FND-DOC-1 +
    //   gỡ cặp orphan export:foundation-audit-log (0435:346, deprecated từ S2-FND-BE-5) khỏi app-surface (không
    //   route chết). (2) module-toggle audit: THÊM migration nhỏ UNION-add object_type 'module' vào CHECK
    //   audit_logs + sync mảng AUDIT_OBJECT_TYPES (schema/audit.ts) — KHÔNG tái dùng 'company_setting' (audit
    //   trail phải phản ánh đúng hành động). (3) Lock-list module-lõi KHÔNG được tắt = CHỐT CỨNG cả 7 module MVP
    //   hiện có (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI) — toggle này thực chất nhắm module Phase 2 tương lai
    //   (PAYROLL/RECRUIT/ASSET/ROOM/CHAT/SOCIAL/...), chưa module MVP nào nên được phép tắt.
    // Sửa thêm theo plan-reviewer round 4: (4) step-1 ghi SAI cặp quyền — retention dùng 363 (manage:foundation-
    //   retention), KHÔNG PHẢI 346 (đó là export orphan, giờ đã defer hẳn). (5) module-toggle PHẢI tự viết+audit
    //   TRONG module-catalog/** (KHÔNG gọi SettingService.updateCompanySetting của lane settings — tránh đụng
    //   file chéo lane + tránh mislabel object_type). (6) barrel packages/contracts/src/foundation/index.ts: SERIALIZE
    //   (1 lane cuối cùng append, không chạy 4 lane song song rồi merge tay) để tránh ghi đè export lẫn nhau.
    status: "todo",
    paths: [
      "apps/api/src/foundation/settings/**",
      "apps/api/src/foundation/module-catalog/**",
      "apps/api/src/foundation/retention/**",
      "apps/api/migrations/**",
      "apps/api/src/db/schema/audit.ts",
      "packages/contracts/src/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-FND-BE-5"],
    src: [
      "audit FOUNDATION 2026-07-02 (§6.1/§6.3 orphan)",
      "API-09 §10 (settings) + §9.5 (export)",
      "BACKEND-04 §9.3/§9.4 + §11.7",
      "BACKEND-11 §9.8 (retention API)",
    ],
    done_when: [
      "GET/PATCH /foundation/system-settings(/:key): gate system-manage:foundation-setting (sensitive, System-scope); PATCH validate value_type/schema như company path + audit SYSTEM_SETTING_UPDATED — BẮT BUỘC dùng `withTenant(actor.companyId)` cho CẢ mutation lẫn audit trong CÙNG tx (KHÔNG `withTransaction`); object_type 'system_setting' đã dành chỗ trong CHECK 0439 — verify, thiếu thì migration UNION; mask sensitive khi đọc như company; test positive-path PHẢI dùng principal super-admin/được-grant-tường-minh (company-admin 0435 KHÔNG có cặp is_sensitive=true này)",
      "PATCH /foundation/modules/:code (enable/disable qua company_settings 'module.<code>.enabled'): gate update:foundation-module (super-admin cho test positive) + audit CONFIG TỰ VIẾT trong module-catalog/** (KHÔNG mượn SettingService) với object_type='module' MỚI (migration UNION-add vào CHECK audit_logs + sync AUDIT_OBJECT_TYPES, cùng đợt với WO này — không tách follow-up) + permissionCode phản ánh đúng module-toggle; my-apps/admin-list phản ánh ngay; module-lõi KHÓA CỨNG = 7 module MVP (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI) — toggle 7 module này PHẢI 400/403, có test đo được; barrel packages/contracts/src/foundation/index.ts SERIALIZE 1 lane cuối append (không parallel-rồi-merge)",
      "Audit-export: KHÔNG build (owner chốt DEFER 2026-07-04) — xoá/không-route cặp export:foundation-audit-log (0435:346, đã deprecated ở S2-FND-BE-5) khỏi mọi nơi tham chiếu app-surface (my-apps metadata, docs) nếu còn sót; pin quyết định defer vào S2-FND-DOC-1",
      "Retention: POST /foundation/retention-policies (create, gate manage:foundation-retention — cặp 363, KHÔNG PHẢI 346) + POST /:id/simulate expose service sẵn; createPolicy (retention.service.ts:90-129) HIỆN THIẾU audit (updatePolicy đã có) → BẮT BUỘC thêm audit RETENTION_POLICY_CREATED in-tx (object_type 'retention_policy' đã có trong CHECK 0456, KHÔNG cần migration riêng); simulate/runCleanup guard not-found → 404 (hết 500) — verify retention-cleanup.job.ts CHỊU ĐƯỢC NotFoundException khi policy bị soft-delete giữa list và run (race); giữ PROTECTED_TABLES + isSensitive như S2-FND-BE-3",
      "deny-path RED viết-TRƯỚC từng route (403 thiếu quyền + 0 audit · 2-tenant deny); FULL gate + người chốt; contracts Zod dual-build; migration UNION-add object_type 'module' verify chain 0000→head xanh LANE_DB",
    ],
  },
  {
    id: "S2-FND-JOBS-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "System Jobs khung tối thiểu (audit §5.2, DB-08 §8.14-15 + BACKEND-11 §18): bảng system_job_runs/locks + JobRunner trên WorkerScheduler + schedule RetentionCleanupJob + TEMP_FILE_CLEANUP",
    zone: "red",
    // AUDIT 2026-07-02 (HIGH gộp): khung §18 THIẾU toàn bộ — không system_job_runs/system_job_locks (DB-08 §8.14/8.15),
    //   không JobRegistry/JobLock, không API /system-jobs; scheduler duy nhất = setInterval outbox
    //   (scheduler/worker-scheduler.service.ts:44-73, cố ý không @nestjs/schedule). RetentionCleanupJob skeleton CÓ
    //   (dry-run default TRUE) nhưng CHƯA schedule (retention.module.ts:13 'wire ở BE-9'). TEMP_FILE_CLEANUP: cột
    //   is_temporary/expires_at + index CÓ SẴN (schema/files.ts:65-66,84-86) nhưng không job đọc; file 'Pending'
    //   mồ côi không ai dọn. API /system-jobs (view/run:foundation-job đã seed) = OPTIONAL đợt này — chốt khi làm.
    status: "todo",
    paths: [
      "apps/api/migrations/**",
      "apps/api/src/db/schema/**",
      "apps/api/src/scheduler/**",
      "apps/api/src/foundation/retention/**",
      "apps/api/src/foundation/files/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (§5.2 SYSTEM JOBS)",
      "DB-08 §8.14/§8.15",
      "DB-09 §8.11/§8.12",
      "BACKEND-11 §17/§18",
    ],
    done_when: [
      "migration NỐI TIẾP head: system_job_runs + system_job_locks đúng shape DB-08 §8.14/8.15 + index DB-09 §8.11/8.12; RLS mẫu nullable-tenant (job global company_id NULL); grant app KHÔNG DELETE; db:check chain xanh",
      "JobRunner tối thiểu trên WorkerSchedulerService hiện có (GIỮ setInterval — không đổi cơ chế): trước khi chạy lấy lock system_job_locks (locked_until, chống 2 instance chạy trùng), ghi system_job_runs start→success/error (đếm affected, error message KHÔNG secret); job fail KHÔNG sập app (mẫu outbox)",
      "RetentionCleanupJob wire lịch qua JobRunner: dry-run default TRUE giữ nguyên + kill-switch env; PROTECTED_TABLES giữ nguyên (audit/file_access_logs KHÔNG BAO GIỜ purge — BẤT BIẾN #2); chạy thật per-tenant có ghi run",
      "TEMP_FILE_CLEANUP job: soft-delete + storage delete file is_temporary hết expires_at VÀ file upload_status='Pending' quá TTL (setting 'file.pending_ttl_hours' — thêm default); ghi file_access_logs/audit theo mẫu delete hiện có",
      "RED test: 2 runner song song → 1 chạy 1 skip (lock); job error → run ghi 'error' + app sống; FULL gate (migration + append-only kề audit) + người chốt; lane db NỐI TIẾP",
    ],
  },
  {
    id: "S2-FND-FILE-2",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "Upload file E2E (audit H3, BACKEND-11 §11.4): chốt mô hình presigned-PUT + POST /:id/confirm → upload_status 'Uploaded' + checksum + extension↔MIME + blocked_extensions",
    zone: "red",
    // AUDIT 2026-07-02 (HIGH #3): POST /foundation/files/upload CHỈ đăng ký metadata (Pending) — không đường binary
    //   (không multipart, không presigned-PUT; port storage.signedUrl chỉ TASK dùng), không confirm → file kẹt
    //   Pending vĩnh viễn; checksum_sha256/content_hash (schema/files.ts:52-53) không bao giờ tính;
    //   download_count/last_accessed_at không bao giờ ghi; extension↔MIME không đối chiếu; blocked_extensions
    //   setting không tồn tại (§11.6.4/6.6/6.7). Sau WO này download-guard (S2-FND-BE-4) có dữ liệu Uploaded thật.
    status: "todo",
    paths: [
      "apps/api/src/foundation/files/**",
      "apps/api/src/storage/**",
      "apps/api/src/foundation/settings/setting-defaults.ts",
      "packages/contracts/src/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-FND-BE-4"],
    src: [
      "audit FOUNDATION 2026-07-02 (H3 + §5.2 FILE)",
      "BACKEND-11 §11.4/§11.6/§11.9/§25.1",
      "DB-08 §8.6",
    ],
    done_when: [
      "OWNER CHỐT mô hình (đề xuất: presigned-PUT TTL-ngắn + POST /foundation/files/:id/confirm — khớp StorageAdapter sẵn có, không stream binary qua NestJS); kết luận pin vào BACKEND-11 (1 dòng CHỐT) nếu lệch multipart doc",
      "luồng E2E: register (Pending, validate size/MIME/extension↔MIME/blocked_extensions từ settings — thêm key 'file.blocked_extensions' default exe/bat/cmd/sh/js…) → client PUT presigned → confirm: HEAD/GET storage verify tồn tại + size khớp khai báo + tính checksum_sha256 server-side → set 'Uploaded'; confirm sai size/không tồn tại → 'Failed' + lý do",
      "download/download-url tăng download_count + last_accessed_at (best-effort, không chặn luồng); file Pending quá TTL → TEMP_FILE_CLEANUP dọn (S2-FND-JOBS-1 — nếu JOBS-1 chưa land thì ghi TODO trỏ, KHÔNG tự chế job)",
      "int-spec E2E trên MinIO local (docker compose sẵn) + LANE_DB: upload→confirm→download OK; confirm sai size → Failed; presign TTL clamp giữ (adapter :67-71); FULL gate (file = crown) + người chốt",
    ],
  },
  {
    id: "S2-FE-FND-7",
    module: "FOUNDATION",
    layer: "FE",
    title:
      "FE System sửa nhỏ theo audit (H8 + §7): defaultRoute app Hệ thống → /system + 4 sidebar entry FOUNDATION + GROUP_LABELS 'master-data' + audit-logs default date-range",
    zone: "yellow",
    // AUDIT 2026-07-02 (HIGH #8 UX, sửa 1 dòng + phụ kiện): registry.ts:556 defaultRoute '/system/settings' =
    //   SystemSettingsPage placeholder 'sắp ra mắt' → mở app Hệ thống từ Home Portal/AppSwitcher rơi màn trống.
    //   Sidebar FOUNDATION (sidebar-registry.ts:396-512) thiếu entry Public Holidays · Health · Retention ·
    //   File Access Logs (chỉ vào được qua quick-link Overview); entry System Settings THÊM SAU S2-FND-BE-8 (đừng
    //   trỏ placeholder). GROUP_LABELS thiếu 'master-data' → HR hiện label thô (ModuleSidebar.tsx:32-39).
    //   AuditLogsPage thiếu default date-range 7/30 ngày (FRONTEND-13 §21.2).
    status: "todo",
    paths: ["apps/app/**", "packages/web-core/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (H8 + §7.1/§7.2)",
      "FRONTEND-13 §7.1/§8/§21.2",
      "FRONTEND-05 (sidebar registry)",
    ],
    done_when: [
      "APP_REGISTRY app 'system' defaultRoute → '/system' (Overview); test route-authz/registry-guard cập nhật khớp",
      "sidebar-registry FOUNDATION thêm 4 entry: /system/public-holidays · /system/health · /system/retention · /system/file-access-logs — gate bằng ĐÚNG cặp quyền route-meta hiện có (KHÔNG hard-code nhãn doc); KHÔNG thêm entry /system/settings (placeholder) — ghi comment chờ S2-FND-BE-8",
      "GROUP_LABELS thêm 'master-data' (nhãn vi); AuditLogsPage default filter from=30-ngày-gần-nhất (giữ đổi được); i18n vi đủ key mới",
      "KHÔNG hard-code role; web test + typecheck xanh; LIGHT gate",
    ],
  },
  {
    id: "S2-FND-DB-2",
    module: "FOUNDATION",
    layer: "DB",
    title:
      "DB hygiene theo DB-09 (audit §3.2, P2): index bổ sung (files/file_access_logs/sequence) + uq_file_links_entity_file_active + trigger chặn UPDATE audit_logs lớp 2",
    zone: "red",
    // AUDIT 2026-07-02: thiếu idx_files_company_status · idx_files_cleanup_deleted · idx_file_access_logs
    //   (company_id, created_at DESC) composite · idx_sequence_counters_reset · uq_file_links_entity_file_active
    //   (không gì chặn link TRÙNG cùng file vào cùng entity khi non-primary — 0433:175-177 chỉ ép primary).
    //   audit_logs: header DB-08 dòng 1 yêu cầu 'REVOKE + trigger' — hiện chỉ grant-level, thiếu trigger lớp 2.
    //   idx_audit_logs_entity thiếu company_id-first + created_at (deviation kế thừa 0438:33-35) — chốt cùng đợt.
    // OWNER CHỐT 2026-07-03 (checkpoint feat/debt-wave2, sau plan-BLOCK round 1): MỞ RỘNG paths sang service layer
    //   để làm trọn map 409 trong CÙNG WO (quyết định chủ động — KHÔNG tách follow-up), xem done_when #2.
    // LANE A (mig 0472, commit ba3527e) + LANE B (service-layer 409 map) đã code xong trên feat/debt-wave2
    //   2026-07-04: files.service.ts link() bọc 23505 phân biệt uq_file_links_entity_file_active →
    //   FOUNDATION-FILE-ERR-DUP-LINK / uq_file_links_primary_per_entity_type → FOUNDATION-FILE-ERR-DUP-PRIMARY
    //   (2 mã đăng ký error-codes.ts, append-only); colocated unit spec (5 case) + int-spec re-link→409 +
    //   DUP-PRIMARY (2 file khác nhau) + 2-tenant isolation (3 case). Full suite LANE_DB: 283 file/4330 test
    //   pass. Đang CHỜ FULL gate (database-reviewer, chạm audit_logs = crown) + người chốt red-zone trước khi
    //   flip status "done" (mig 0472 KHÔNG auto-merge — red zone).
    // SHIPPED 2026-07-04 qua PR #113 (merged vào feat/debt-wave2).
    status: "done",
    paths: [
      "apps/api/migrations/**",
      "apps/api/src/db/schema/**",
      "apps/api/src/foundation/files/files.service.ts",
      "apps/api/src/foundation/files/**/*.repository.ts",
      "apps/api/src/common/db-error.ts",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (§3.2)",
      "DB-09 §8.5-8.10",
      "DB-08 header (REVOKE + trigger)",
    ],
    done_when: [
      "migration NỐI TIẾP head: idx_files_company_status (company_id,upload_status,uploaded_at DESC) · idx_files_cleanup_deleted partial · idx_file_access_logs_company_time (company_id,created_at DESC — PIN tên canonical DB-09 §8.8, KHÔNG trùng/nhầm file_access_logs_company_id_idx sẵn có) · idx_sequence_counters_reset partial (Yearly/Monthly/Daily) — tên/shape theo DB-09, schema drizzle đồng bộ",
      "uq_file_links_entity_file_active partial (deleted_at IS NULL), key ĐÚNG 6 cột (company_id,module_code,entity_type,entity_id,file_id,link_type): TRƯỚC khi ép — dedupe PHẢI nhóm ĐÚNG 6 cột uq (KHÔNG dùng nhầm shape 5-cột is_primary cũ 0433:175 — sẽ soft-delete NHẦM link hợp lệ khác file_id), thứ tự GIỮ xác định `is_primary DESC, created_at ASC, id ASC` (id là tie-break cuối, tránh trường hợp ≥2 hàng is_primary=true cùng nhóm làm CREATE UNIQUE vẫn vỡ); phần còn lại soft-delete (deleted_at=now); thêm test khẳng định link hợp-lệ-khác-file KHÔNG bị soft-delete nhầm. SAU khi ép constraint: FileService.link() (files.service.ts:349) PHẢI bọc bắt 23505 qua isUniqueViolation() (common/db-error.ts) — PHÂN BIỆT qua constraint name (pgErrorField(err,'constraint')): vi phạm uq_file_links_entity_file_active MỚI → ConflictException('FOUNDATION-FILE-ERR-DUP-LINK'); vi phạm uq_file_links_primary_per_entity_type CŨ (0433) → mã KHÁC (vd 'FOUNDATION-FILE-ERR-DUP-PRIMARY') — KHÔNG gộp chung 1 mã cho 2 nguyên nhân khác nhau; đăng ký cả 2 mã trong error-codes.ts hiện có (S2-FND-CONTRACT-1 sẽ reconcile vào catalog canonical sau, append-only không xung đột); colocated unit test khẳng định đúng mã theo từng constraint",
      "trigger BEFORE UPDATE OR DELETE ON audit_logs → RAISE EXCEPTION lớp 2 (sau REVOKE — DB-08 header) — round 3 FIX: PHẢI phủ CẢ UPDATE VÀ DELETE (round 2 chỉ ghi UPDATE — nếu 1 migration sau lỡ GRANT DELETE cho mediaos_app, hard-delete audit_logs sẽ THÀNH CÔNG vì chỉ có lớp-1 REVOKE, không lớp-2; append-only nghĩa là chặn CẢ 2 hành vi). BẮT BUỘC DENYLIST chặn current_user='mediaos_app' (chỉ app-role; mediaos_worker đã chặn đủ ở lớp-1 REVOKE, KHÔNG cần thêm vào denylist — ghi comment rõ 2 lớp phòng thủ) — TUYỆT ĐỐI KHÔNG allowlist kiểu 'trừ mediaos_owner'. RED test: (a) app role UPDATE audit_logs bị chặn, assert message chứa 'append-only'; (a2) SONG SONG: app role DELETE audit_logs CŨNG bị chặn cùng cơ chế (temp-GRANT DELETE cho mediaos_app trong try/finally → xác nhận vẫn bị trigger chặn dù có grant); (b) POSITIVE: superuser/directPool UPDATE VÀ DELETE audit_logs đều THÀNH CÔNG. PIN tên cụ thể function+trigger, presence-test assert qua pg_trigger/pg_proc. idx_sequence_counters_reset: predicate WHERE reset_policy IN (...) PHẢI khớp CHÍNH XÁC casing CHECK thật (đối chiếu mig 0434/0437) — assert qua pg_indexes.indexdef",
      "SỬA LỖI round 2 (owner bake trước dùng tên KHÔNG theo canonical — plan-reviewer round 3 bắt được): index mới (company_id,entity_type,entity_id,created_at DESC) đặt tên ĐÚNG canonical DB-09 §8.5 = `idx_audit_logs_company_entity` (KHÔNG phải `idx_audit_logs_entity_created` như round 2 tạm đặt để né trùng tên — tên đó không sai về mặt kỹ thuật nhưng lệch nguồn-sự-thật DB-09, sẽ đẻ reconcile-WO sau nếu giữ). `idx_audit_logs_entity` (module_code-led, mig 0432) GIỮ NGUYÊN không đụng — 2 tên khác nhau, không trùng. PIN `idx_audit_logs_company_entity` vào task/acceptance/test; presence-test assert qua pg_indexes.indexdef (không chỉ match tên). Thêm 1 case integration xác nhận uq_file_links_entity_file_active đổi hành vi re-link-trùng từ THÀNH CÔNG (hiện tại) sang 409 là CÓ CHỦ ĐÍCH (grep FE/service hiện tại xác nhận không luồng nào phụ thuộc re-link idempotent-thành-công; nếu có thì đây là finding MỚI cần báo trước khi land, không tự ý đổi test cho khớp)",
      "db:check chain 0000→head xanh LANE_DB (xác nhận idx/when kế tiếp đúng head hiện tại lúc land — có thể đã đổi vì lane khác trong cùng checkpoint); FULL gate (database-reviewer — chạm audit) + người chốt; lane db NỐI TIẾP",
    ],
  },
  {
    id: "S2-FND-CONTRACT-1",
    module: "BACKEND",
    layer: "API",
    title:
      "API contract hygiene theo BACKEND-12 (audit §6.2, P2): Swagger/OpenAPI /docs + bộ mã FOUNDATION-ERR-* + chốt pagination request + migrate DTO cục bộ vào contracts",
    zone: "yellow",
    // AUDIT 2026-07-02: Swagger/OpenAPI KHÔNG TỒN TẠI (main.ts không SwaggerModule, không @nestjs/swagger,
    //   không openapi/ artifact — kể cả openapi/enterprise-api.yaml mà API-10 AUD-005 nói 'đã áp dụng');
    //   FOUNDATION-ERR-* 0/18 dùng (error-codes.ts:10-20 chỉ generic); pagination request lệch chuẩn §15.1
    //   (code page+limit, audit limit+offset vs doc page+per_page); DTO settings/holidays/company-patch còn Zod
    //   cục bộ apps/api (contracts/src/foundation/index.ts:4-6 tự nhận nợ).
    status: "todo",
    paths: [
      "apps/api/src/main.ts",
      "apps/api/src/common/**",
      "apps/api/src/foundation/**",
      "apps/api/package.json",
      "packages/contracts/src/**",
      "docs/BACKEND/**",
      "apps/api/test/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (§6.2)",
      "BACKEND-12 §8/§12/§15/§21",
      "API-09 §21 (FOUNDATION-ERR)",
    ],
    done_when: [
      "SwaggerModule (hoặc OpenAPI từ nestjs-zod) mount /docs — env-gate (bật dev/staging, tắt prod theo owner); artifact openapi.json sinh được bằng script; operationId + tag theo module; x-required-permission best-effort từ @RequirePermission (không chặn nếu khó — ghi TODO)",
      "bộ mã FOUNDATION-ERR-* ADDITIVE vào error filter/catalog (403 foundation phân biệt được với AUTH-ERR-FORBIDDEN; SETTING-INVALID-VALUE, FILE-NOT-FOUND… theo API-09 §21); KHÔNG đổi HTTP status hiện hành TRỪ chốt 422→400 cho validation_schema (theo doc — hoặc pin 422 vào doc, owner chọn)",
      "OWNER CHỐT pagination request: pin 'page+limit' của code vào BACKEND-12 §15.1 (đề xuất — ít vỡ FE) HOẶC đổi code sang per_page (kèm alias tương thích); audit-logs limit+offset chốt cùng đợt; response block pagination giữ nguyên (đã đúng)",
      "DTO settings/holidays/company-patch migrate vào packages/contracts (dual-build, apps/api import lại — KHÔNG đổi shape); gỡ ghi chú nợ ở contracts/src/foundation/index.ts; typecheck + suite xanh; LIGHT gate",
    ],
  },
  {
    id: "S2-FND-DOC-1",
    module: "FOUNDATION",
    layer: "DOC",
    title:
      "Pin lệch-có-chủ-đích Foundation vào docs (DB-08/09/10 · BACKEND-04/11/12 · API-09/10 · FRONTEND-13): code thắng ở các điểm đã chốt — chặn audit sau báo 'lệch' giả",
    zone: "green",
    status: "todo",
    paths: [
      "docs/DB/**",
      "docs/BACKEND/**",
      "docs/API Design/**",
      "docs/FRONTEND/**",
      "docs/_review/**",
    ],
    skills: [],
    depends_on: [],
    src: [
      "audit FOUNDATION 2026-07-02 (§3.3/§5.3/§6.1 + §8 mục 20 — memory foundation-system-audit-2026-07)",
      "CLAUDE.md §1 (docs là chuẩn — pin để doc PHẢN ÁNH quyết định)",
    ],
    done_when: [
      "API-09/API-10/BACKEND-11 pin: permission = tuple (action,resource_type) namespace foundation-* thay MODULE.RESOURCE.ACTION · single-tenant v2 CẮT multi-company endpoints (GET/POST /companies, suspend/activate) + 7 internal REST /internal/v1/foundation/* (in-process service call thay thế — modular monolith) · download = 302 presigned TTL-ngắn thay stream · my-apps Authenticated-only tự lọc capability · path/method lệch nhỏ đã chấp nhận (preview GET theo :id · check-working-day · /seeds · file-links nested)",
      "DB-08/DB-09/DB-10 pin + sửa doc-drift NỘI BỘ: DB-09 tham chiếu cột không tồn tại (accessed_at→created_at · files.checksum→checksum_sha256/content_hash · uq holiday theo name→holiday_code) — sửa DB-09 khớp DB-08; is_paid→is_paid_holiday · audit_logs Option-A (company_id NOT NULL mạnh hơn doc + cột legacy giữ) · retention PROTECTED_TABLES (audit/file_access_logs không purge — archive path = future) · seed company-scoped qua RUNTIME seeder thay migration (0445:14-18) · seed_batches status enum Success thay Applied",
      "OWNER CHỐT 2 quyết định còn treo rồi ghi vào doc: (1) bảng companies reconcile theo DB-08 §8.1 (company_code unique/status enum/cột thiếu) HAY pin code-thắng ở N=1 single-tenant (đề xuất: pin, reconcile khi mở multi-company); (2) module sort_order 1-15 vs doc 10-70 (cosmetic — pin code)",
      "mỗi điểm pin ghi 1 dòng 'CHỐT <ngày>: code thắng/doc sửa, lý do' đúng chỗ (KHÔNG viết lại cả doc); cập nhật trạng thái các mục tương ứng trong docs/_review/FOUNDATION-SYSTEM-AUDIT-2026-07-02.md; KHÔNG đổi hành vi code trong WO này",
    ],
  },
  {
    id: "S2-AUTH-ROLEMEM-1",
    module: "AUTH",
    layer: "BE",
    title:
      "Tab Thành viên trên RoleDetailPage: BE GET /auth/roles/:id/members + FE xem/gỡ/thêm nhanh theo người hoặc phòng ban (owner-request 2026-07-07)",
    zone: "red",
    // CLOSE 2026-07-07: MERGED PR #119 (squash 23e1686) — FULL gate PASS, 6 int-spec + 5 FE spec.
    status: "done",
    paths: [
      "apps/api/src/permission/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/auth/**",
      "packages/web-core/src/lib/**",
      "apps/app/src/routes/system/roles/**",
      "apps/app/src/i18n/**",
      "docs/plans/S2-AUTH-ROLEMEM-1.md",
    ],
    skills: [],
    depends_on: [],
    src: ["owner-request 2026-07-07 (chat)", "S2-AUTH-CAP-2 (PR #117 — nút Quản lý vai trò)"],
    plan: "docs/plans/S2-AUTH-ROLEMEM-1.md",
    done_when: [
      "BE: GET /auth/roles/:id/members (@RequirePermission view:user) trả members active (user_roles deleted_at NULL + chưa expires) join users (id/email/fullName/status/expiresAt/grantedAt); company-scoped qua withTenant + lọc tường minh company_id; role không tồn tại → 404; KHÔNG endpoint mutation mới (thêm/gỡ tái dùng POST/DELETE /permissions/users/:userId/roles sẵn có — giữ nguyên audit+SoD+sensitive gate)",
      "Int-spec RED-trước: deny-path (employee thiếu view:user → 403) · cross-tenant (member tenant A không lộ qua tenant B, kể cả system role dùng chung) · soft-deleted + expired rows bị loại · happy-path admin thấy đúng member sau assign",
      "FE: RoleDetailPage thêm tab switcher (Thông tin | Thành viên); tab Thành viên = bảng member + nút Gỡ (PermissionGate assign-role:user) + dialog 'Thêm người' (search /auth/users, multi-select, gọi tuần tự POST assign, báo kết quả) + dialog 'Thêm theo phòng ban' (org tree → GET /hr/employees?orgUnitId → lọc userId≠null, loại đã-là-member, gọi tuần tự, báo thành công/bỏ qua/lỗi)",
      "contracts roleMemberListSchema dual-build; web-core roleAdminApi.getMembers; i18n vi đủ key; FE spec render + gating; check.sh xanh + FULL gate security-reviewer PASS",
    ],
  },
  {
    id: "S2-AUTH-PERMUX-1",
    module: "AUTH",
    layer: "FE",
    title:
      "Tối ưu gán quyền: BE GET /auth/roles/:id/permissions + RolePermissionsPage v2 (trạng thái thật, nhóm module, bulk) + nhân bản vai trò + nhãn tiếng Việt (owner-request 2026-07-07)",
    zone: "red",
    // CLOSE 2026-07-07: MERGED PR #120 (squash b6dae39) — FULL gate PASS, 7 int-spec + 8 FE spec.
    status: "done",
    paths: [
      "apps/api/src/permission/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/auth/**",
      "packages/web-core/src/lib/**",
      "apps/app/src/routes/system/roles/**",
      "apps/app/src/i18n/**",
      "docs/plans/S2-AUTH-PERMUX-1.md",
    ],
    skills: [],
    depends_on: ["S2-AUTH-ROLEMEM-1"],
    src: ["owner-request 2026-07-07 (chat) — chọn 'Đủ bộ #1→#4'"],
    plan: "docs/plans/S2-AUTH-PERMUX-1.md",
    done_when: [
      "BE: GET /auth/roles/:id/permissions (@RequirePermission view:permission) trả grants (action/resourceType/effect/dataScope/isSensitive) của role; role lạ/cross-tenant/operator → 404; KHÔNG mutation mới (gán/thu hồi/đổi-scope tái dùng POST/DELETE :id/permissions sẵn có — server đã idempotent + DELETE+INSERT đổi scope + scope-ceiling System)",
      "Int-spec: P1 grants exact (gồm row DENY seed thẳng) · N1 employee 403 · N2b role tenant khác 404 · N3 UUID lạ 404 · N5 operator-role 404",
      "FE RolePermissionsPage v2: mỗi dòng hiện TRẠNG THÁI ĐÃ GÁN + scope hiện tại (bỏ banner mù-trạng-thái); nhóm theo resourceType thu gọn/mở rộng; đổi scope ngay trên dropdown; bulk: tick nhiều dòng → 1 scope → Gán 1 lượt (tuần tự, kết quả từng dòng); search giữ nguyên",
      "Nhân bản vai trò: nút trên RoleDetailPage (gate create:role + assign:permission) → dialog tên mới → createRole → copy grants ALLOW từ role nguồn (bỏ System-scope theo ceiling, bỏ DENY — báo rõ), điều hướng sang role mới",
      "Nhãn tiếng Việt action/resource cho module MVP (fallback mã thô); spec FE cập nhật (bỏ assert banner cũ, thêm state-render + clone flow); check.sh xanh + FULL gate security-reviewer PASS",
    ],
  },
  {
    id: "S2-AUTH-USEROPS-1",
    module: "AUTH",
    layer: "BE",
    title:
      "Quản lý người dùng nâng cao: xóa mềm + khôi phục + admin reset mật khẩu + thao tác hàng loạt trên /system/users (owner-request 2026-07-07)",
    zone: "red",
    // CLOSE 2026-07-07: MERGED PR #121 (squash f0a78e2) — plan-review BLOCK→REVISED, FULL gate
    // security+db PASS, api 4595 pass lane DB, gitleaks false-positive fixture đã gỡ (.gitleaksignore).
    status: "done",
    paths: [
      "apps/api/src/users/**",
      "apps/api/migrations/**",
      "packages/contracts/src/auth/**",
      "packages/contracts/src/auth.ts",
      "packages/web-core/src/lib/**",
      "apps/app/src/routes/system/**",
      "apps/app/src/i18n/**",
      "docs/plans/S2-AUTH-USEROPS-1.md",
    ],
    skills: [],
    depends_on: [],
    src: ["owner-request 2026-07-07 (chat, screenshot /system/users)"],
    plan: "docs/plans/S2-AUTH-USEROPS-1.md",
    done_when: [
      "Migration 0476 (idx 156, when 1717500775000): catalog INSERT ('restore','user',true) + ('reset-password','user',true) ON CONFLICT DO NOTHING; NÂNG ('delete','user') 0005 is_sensitive false→true (plan-review phát hiện pair đã tồn tại — INSERT-only là no-op ngầm); grant company-admin × ALLOW × Company (DO-block resolve theo thuộc tính, fail-LOUD verify — mirror mig 0466); KHÔNG đụng RLS users",
      "SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts) APPEND delete:user + restore:user + reset-password:user (bài học CAP-2 — thiếu allowlist ⇒ useCanExact false với CẢ admin) + int-spec USEROPS trong auth-me-capabilities.int.spec.ts (admin đủ 3 cặp; employee không; wildcard không kế thừa)",
      "BE: DELETE /auth/users/:id (soft-delete: deleted_at+deleted_by, GIỮ status, revoke MỌI phiên cùng tx, self-guard 400, audit 'user.deleted' + security event USER_DELETED) · POST /auth/users/:id/restore (clear deleted_at/deleted_by, audit 'user.restored' + USER_RESTORED) · POST /auth/users/:id/password/reset (temp password server-generate đạt policy, hash argon2, must_change_password=true, revoke MỌI phiên, self-guard 400, audit 'user.password_reset_by_admin' KHÔNG chứa mật khẩu, security event PASSWORD_RESET_BY_ADMIN; tempPassword CHỈ trả 1 lần trong response, KHÔNG log) — cả 3 @RequirePermission isSensitive:true đúng cặp seed 0476",
      "GET /auth/users?deleted=true trả riêng user đã xóa mềm (repo tách nhánh isNull/isNotNull, DTO thêm deletedAt); login/forgot vẫn loại deleted (đã có isNull(deletedAt) — không đổi)",
      "Unit spec RED-trước: self-delete/self-reset 400 no-op · not-found/cross-tenant 404 KHÔNG audit rác · delete/reset revoke phiên đúng 1 lần + count vào audit · audit KHÔNG chứa tempPassword/passwordHash · restore đòi row deleted · temp password đạt policy (≥12, hoa+thường+số)",
      "web-core: authUsersApi.deleteUser/restoreUser/resetPassword + listUsers({deleted}) + spec; contracts SECURITY_EVENT_TYPES thêm USER_DELETED/USER_RESTORED/PASSWORD_RESET_BY_ADMIN + severity đủ (exhaustive record)",
      "FE /system/users: cột checkbox chọn nhiều + thanh bulk (Khóa/Mở khóa/Xóa — tuần tự per-item, kết quả từng dòng, self-row tự loại); menu thao tác từng dòng (Chi tiết/Khóa/Mở khóa/Đặt lại mật khẩu/Xóa); tab 'Đã xóa' (gate useCanExact restore:user) + nút Khôi phục; dialog kết quả reset hiển thị temp password đúng 1 lần + copy; nút sensitive dùng useCanExact (delete/restore/reset-password), lock/unlock dùng useCan; i18n vi đủ key; FE spec gating + bulk",
      "pnpm typecheck + test + build xanh toàn workspace; FULL gate security-reviewer + database-reviewer PASS; PR KHÔNG auto-merge (vùng đỏ, người chốt)",
    ],
  },

  // ════════════════════ SPRINT 4 — TASK · NOTI · DASH (EPIC-06/07/08) ════════════════════
  // IMPLEMENTATION-07 · DB-06 (TASK) · DB-07 (NOTI DASH) · API-06/07/08 · SPEC-06/07/08 · UI-06/07/08.
  // Thứ tự phụ thuộc bắt buộc: TASK → NOTI → DASH → integration (event/widget) → QA. Migration nối tiếp head
  // (0477+), 3 lane DB đánh số TUẦN TỰ (TASK-DB → NOTI-DB → DASH-DB) — KHÔNG chạy song song migration.
  // RECONCILE-FIRST: đã có module cũ hướng media-OS ở apps/api/src/{tasks,notifications,dashboard} (đang mount) —
  // đối chiếu DB-06/07 + SPEC, giữ phần khớp, đổi tên/dọn phần lệch, KHÔNG db:generate drop. Module catalog
  // TASK/NOTI/DASH đã active (S0-FND-SEED-1) — SEED lane chỉ thêm permission/event/template/widget.
  {
    id: "S4-TASK-DB-1",
    module: "TASK",
    layer: "DB",
    title:
      "Schema + migration TASK core (projects·project_members·tasks·task_assignees·task_watchers·task_comments·task_checklists·task_checklist_items·task_activity_logs) theo DB-06 — RLS+FORCE, soft-delete, index, check-constraint",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-TASK-DB-1.md",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-DB-001/002/003)",
      "DB-06",
      "SPEC-06",
      "IMP02-STORY-065/066/068",
    ],
    plan: "docs/plans/S4-TASK-DB-1.md",
    done_when: [
      "Migration đánh số tiếp head (0477+): tạo/hoàn thiện bảng MVP bắt buộc theo DB-06 (projects, project_members, tasks, task_assignees, task_watchers, task_comments, task_checklists, task_checklist_items, task_activity_logs); mỗi bảng nghiệp vụ có id UUID gen_random_uuid() + company_id NOT NULL + audit cols (created/updated_at/by) + soft-delete (deleted_at/by) cho bảng chính; task_activity_logs append-only",
      "BẤT BIẾN #1: mọi bảng company-scoped ENABLE + FORCE RLS + policy company_id TRƯỚC bất kỳ backfill; đăng ký rls-registry; FK companies/users/employee_profiles/org_units (đối chiếu tên thật — KHÔNG dùng employees/departments per bài học S3-ATT-DB-1)",
      "Unique chống trùng member/assignee/watcher ACTIVE (partial WHERE deleted_at IS NULL); CHECK status (Todo/In Progress/In Review/Done/Cancelled) · priority (Low/Medium/High/Urgent) · project_role (Owner/Manager/Member/Viewer); index my-tasks (assignee+status+due), project Kanban, activity log",
      "RECONCILE: đối chiếu module cũ apps/api/src/tasks (labels/project-states/attachments/pm-fields) — giữ bảng khớp DB-06, đổi tên/park phần lệch; ghi bản đồ reconcile trong plan; KHÔNG db:generate drop, migration additive",
      "Int-spec RED-trước trên lane DB cô lập: cross-tenant deny (tenant A không đọc/ghi task tenant B) + append-only task_activity_logs (insert OK, update/delete DENY) + unique-active guard; migration-smoke clean 0000→head xanh; FULL gate database-reviewer + rls-tenant-isolation-tester PASS",
    ],
  },
  {
    id: "S4-TASK-RECON-1",
    module: "TASK",
    layer: "DB",
    title:
      "Đối soát pair-drift + grant tồn dư TASK: ánh xạ cặp legacy đang enforce → canonical DB-06 §12.1, gỡ grant ngoài ma trận §6 (chạy TRƯỚC S4-TASK-SEED-1)",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/tasks/**",
      "apps/api/src/foundation/seed/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-TASK-RECON-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-DB-1"],
    src: [
      "docs/DB/DB-06 §12.1 (23 mã TASK canonical)",
      "docs/permission-matrix-spec.md §6",
      "apps/api/migrations/0005_permissions.sql (seed gốc, L225/L251/L313-400)",
      "apps/api/src/tasks/tasks.controller.ts:206 (legacy comment:comment)",
    ],
    plan: "docs/plans/S4-TASK-RECON-1.md",
    done_when: [
      "OWNER CHỐT 2026-07-09 (plan-block S4-TASK-SEED-1 → tách WO reconcile riêng): WO này CHỈ đối soát cặp + grant. KHÔNG seed catalog mới, KHÔNG đụng is_sensitive — hai việc đó thuộc S4-TASK-SEED-1.",
      "Quét HẾT @RequirePermission trong apps/api/src/tasks (không bỏ sót route nào) → bảng ánh xạ tường minh trong plan: cặp legacy đang enforce ⇒ cặp canonical DB-06 §12.1. ĐÃ XÁC MINH: ('comment','comment') @tasks.controller.ts:206 ⇒ ('comment','task'). Các cặp legacy khác ở 0005 (('manage','project') · ('assign','project') · ('manage','task') · ('submit','task')) phải ĐỌC CODE xác định đích canonical, KHÔNG đoán từ tên.",
      "Thứ tự migration AN TOÀN (không mở cửa sổ 403 cho route đang chạy): (1) seed cặp canonical còn thiếu ON CONFLICT DO NOTHING → (2) grant cặp canonical cho role theo §6 → (3) đổi @RequirePermission sang cặp canonical → (4) revoke/park grant legacy. KHÔNG đảo thứ tự. ⚠️ CHỐT 2026-07-09: (4) cho cặp ĐANG được route sống enforce PHẢI tách sang RELEASE SAU (S4-TASK-RECON-2) — mig 0480 là EXPAND-ONLY.",
      "Liệt kê + gỡ grant TASK/PROJECT tồn dư ngoài ma trận §6 cho 4 role canonical (0005 L313-400); int-spec ĐẾM tổng grant TASK của mỗi role đúng kỳ vọng (không dư, không thiếu)",
      "Int-spec RED-trước: route comment task VẪN 2xx cho role được phép sau khi đổi cặp + 403 cho role không phép; employee DENY create/update/delete/close/archive:project; hr DENY close/delete/archive/manage-member:project và delete:task",
      "Gate int-spec = hasDb && LANE_DB (chỉ .env → hasDb=true = đỏ-giả). FULL gate security-reviewer + database-reviewer PASS",
    ],
  },
  {
    id: "S4-TASK-RECON-2",
    module: "TASK",
    layer: "DB",
    title:
      "CONTRACT pair-drift TASK: gỡ grant legacy ('comment','comment') khỏi employee + company-admin — chạy ở RELEASE SAU khi code gate ('comment','task') đã chạy ổn định",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-TASK-RECON-2.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-RECON-1"],
    src: [
      "apps/api/migrations/0480_s4_taskrecon1_task_pair_drift_grants.sql (khối EXPAND-ONLY)",
      "apps/api/test/integration/task-recon-grants.int-spec.ts (test (c') khoá trạng thái transitional)",
      "docs/DB/DB-06 §12.1",
    ],
    plan: "docs/plans/S4-TASK-RECON-2.md",
    done_when: [
      "OWNER CHỐT 2026-07-09 — nửa CONTRACT của expand-contract. Mig 0480 (RECON-1) cố ý GIỮ grant legacy ('comment','comment') song song ('comment','task') để code cũ không ăn 403 trong khe migrate→restart (Invoke-Migrate KHÔNG stop service; Release job còn là placeholder TODO). WO này gỡ nốt.",
      "ĐIỀU KIỆN TIÊN QUYẾT (verify TRƯỚC khi viết migration): code gate ('comment','task') ĐÃ deploy và chạy ổn định trên mọi môi trường (prod + dev-online); `grep -rn \"'comment', *'comment'\" apps/api/src` == 0. Nếu chưa, DỪNG — báo người.",
      "Migration đánh số nối tiếp head (đọc apps/api/migrations/meta/_journal.json lấy idx/when thật, when nối tiếp +5000): PER-PAIR DELETE grant ('comment','comment') cho employee + company-admin (resolve role_id+permission_id trong DO-block, KHÔNG blanket theo role_id — mirror 0444/0445/0480). Thuần data, KHÔNG DDL.",
      "Cân nhắc gỡ luôn permission row ('comment','comment') khỏi catalog nếu KHÔNG role/company-role nào còn tham chiếu (kiểm role_permissions + object-level permissions trước khi xoá); nếu còn tham chiếu → chỉ gỡ grant, giữ catalog row.",
      "Cập nhật test (c') trong task-recon-grants.int-spec.ts: lật từ 'VẪN CÒN = 2' sang 'đã gỡ = 0'; thêm lại ('comment','comment') vào FORBIDDEN_RESIDUAL; test (d) re-park giữ nguyên dùng submit:task.",
      "Int-spec RED-trước: employee + company-admin vẫn POST /tasks/:taskId/comments 2xx (qua comment:task) SAU khi gỡ legacy; role không grant vẫn 403. Gate hasDb && LANE_DB. FULL gate security-reviewer + database-reviewer PASS",
    ],
  },
  {
    id: "S4-TASK-SEED-1",
    module: "TASK",
    layer: "DB",
    title:
      "Seed permission TASK (23 mã canonical DB-06 §12.1) + role-permission mapping (Employee/Manager/HR/Admin/Super Admin) idempotent",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/foundation/seed/**",
      "apps/api/migrations/**",
      // Mở rộng 2026-07-10 (plan §5, nhánh "PHẢI append" của done_when #6): allowlist 8 cặp sensitive
      // TASK ở permission.service.ts + block TASK trong auth-me-capabilities.int.spec.ts — giữ FULL gate.
      "apps/api/src/permission/**",
      "apps/api/src/auth/**",
      "docs/plans/S4-TASK-SEED-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-DB-1", "S4-TASK-RECON-1"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK)",
      "IMPLEMENTATION-07 §8.4",
      "SPEC-06 (permission matrix)",
      "docs/permission-matrix-spec.md",
    ],
    plan: "docs/plans/S4-TASK-SEED-1.md",
    done_when: [
      "OWNER CHỐT 2026-07-09 — CATALOG = ĐÚNG 23 mã canonical DB-06 §12.1, KHÔNG hơn: TASK.PROJECT.{VIEW,CREATE,UPDATE,DELETE,CLOSE,ARCHIVE,MANAGE_MEMBER,VIEW_REPORT} · TASK.TASK.{VIEW,CREATE,UPDATE,DELETE,ASSIGN,COMMENT,WATCH,EXPORT,VIEW_KANBAN,UPDATE_STATUS,UPDATE_PRIORITY,UPDATE_DEADLINE,FILE_UPLOAD,FILE_DELETE} · TASK.AUDIT_LOG.VIEW. BỎ cặp 'checklist' (KHÔNG có trong §12.1 — thao tác checklist gate bằng update:task). docs/DB là chuẩn, KHÔNG phải plan cũ. Migration đánh số nối tiếp head SAU S4-TASK-RECON-1; catalog dùng ON CONFLICT DO NOTHING.",
      "OWNER CHỐT 2026-07-09 — is_sensitive=TRUE cho: delete/close/archive/manage-member/view-report:project + delete/export:task + view:task-audit-log. Còn lại false. ⚠️ ('delete','project') [0005 L225] và ('delete','task') [0005 L251] ĐÃ tồn tại is_sensitive=false ⇒ ON CONFLICT DO NOTHING KHÔNG nâng được. BẮT BUỘC bước idempotent riêng: UPDATE permissions SET is_sensitive=true WHERE (action,resource_type) IN (...) — mirror mig 0476 (đã nâng delete:user false→true).",
      "Grant role-permission theo data_scope PER-(permission,role) (bài học §13): Employee=Own/membership · Manager=Team · HR/Admin=Company; company-admin đủ bộ; resolve theo thuộc tính + verify fail-LOUD (mirror mig 0466/0476)",
      "Nếu đổi data_scope trên grant đã tồn tại → DELETE+INSERT (UNIQUE loại data_scope); KHÔNG re-seed module active (đã active ở S0-FND-SEED-1)",
      "Deny-path RED-trước (KHÔNG chỉ assert 'employee 0 cặp manager-scope' — over-grant Own-scope lọt lưới assert đó): employee can(create|update|delete|close|archive,'project')=DENY; hr can(close|delete|archive|manage-member,'project')=DENY và can('delete','task')=DENY; admin thấy đủ 23 cặp qua /auth/me",
      "Cặp sensitive TASK sẽ KHÔNG surface qua getCapabilities nếu thiếu SENSITIVE_CAPABILITY_ALLOWLIST ⇒ nút FE ẩn với cả admin (bài học CAP-2/USEROPS-1/EXPORT-1). WO này PHẢI append allowlist các cặp sensitive TASK, HOẶC ghi debt tường minh + nêu đích danh S4-FE-TASK-1/2/3 phải append.",
      "Gate int-spec = hasDb && LANE_DB (chỉ .env → hasDb=true = đỏ-giả); seed chạy lại idempotent; FULL gate security-reviewer + database-reviewer PASS",
    ],
  },
  {
    id: "S4-TASK-BE-1",
    module: "TASK",
    layer: "BE",
    title:
      "BE Project CRUD + close/delete mềm + quản lý member (GET/POST /projects, GET/PATCH /projects/:id, close/delete, members add/update-role/remove) — withTenant, permission guard, activity log",
    zone: "yellow",
    status: "done", // PR #144 (plan-review 2026-07-10 nâng gate LIGHT→FULL — docs/plans/S4-TASK-BE-1.md)
    paths: [
      "apps/api/src/tasks/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
      // Mở rộng chủ đích (plan L1): sync Drizzle schema theo mig 0478 đã áp DB — KHÔNG migration mới.
      "apps/api/src/db/schema/**",
      "docs/plans/S4-TASK-BE-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-SEED-1"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-BE-001/002)",
      "API-06",
      "IMP02-STORY-065/066/067",
      "IMPLEMENTATION-07 §9.2/§9.3",
    ],
    plan: "docs/plans/S4-TASK-BE-1.md",
    done_when: [
      "GET/POST /api/v1/projects · GET/PATCH /api/v1/projects/:id · POST /:id/close · DELETE /:id (soft) · GET/POST /:id/members · PATCH/DELETE /:id/members/:memberId — mọi query qua withTenant + lọc company_id; @RequirePermission đúng cặp seed TASK-SEED-1; GET list/detail/members lọc data-scope (employee @Own membership · manager @Team · hr/admin @Company) qua DataScopeService",
      "Business rule P0: chỉ TASK.PROJECT.CREATE mới tạo; người tạo = Owner nếu có employee mapping (set cả user_id legacy NOT NULL lẫn employee_id); KHÔNG thêm member là employee đã nghỉ/chấm dứt; employee chưa có user account → 400 fail-loud; KHÔNG trùng active member (đo cả 2 unique legacy user_id + mới employee_id); project Completed/Cancelled/Archived (cột project_status MỚI) chặn tạo task mới — MVP chặn cứng, không expose override API",
      "Ghi task_activity_logs (PROJECT_CREATED/UPDATED/MEMBER_ADDED/MEMBER_REMOVED) + audit log hành động quan trọng; list có pagination/filter; DTO Zod ở packages/contracts (dual-build), validate input tại boundary; owner-check manager @Team = actor.employeeId === projects.owner_employee_id, NULL → 403 fail-closed",
      "Int-spec RED-trước: deny-path (thiếu quyền tạo/sửa → 403, gồm hr thiếu pair close/delete/manage-member) · cross-tenant (project/member tenant khác → 404, không lộ) · data-scope trong-tenant (@Own membership/@Team — KHÔNG lộ project ngoài scope) · member trùng/nghỉ-việc bị chặn · append-only qua app-role; gate describe.skipIf(!(hasDb && process.env.LANE_DB)); check.sh xanh + FULL gate (permission/audit/RLS — plan-review 2026-07-10 nâng từ LIGHT; chi tiết docs/plans/S4-TASK-BE-1.md)",
    ],
  },
  {
    id: "S4-TASK-BE-2",
    module: "TASK",
    layer: "BE",
    title:
      "BE Task CRUD + My-tasks + filter (GET/POST /tasks, GET/PATCH/DELETE /tasks/:id, GET /tasks/my) — data-scope theo membership/assignee, validation title/project",
    zone: "yellow",
    status: "done", // PR #145 (abc0a6a) 2026-07-11 — BREAKING GET /tasks: my-tasks → /tasks/my; nợ dọn tasksApi → S4-FE-TASK-CLEANUP-1
    paths: ["apps/api/src/tasks/**", "apps/api/test/integration/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-1"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-BE-003)",
      "API-06",
      "IMP02-STORY-068/069",
      "IMPLEMENTATION-07 §9.2/§9.3",
    ],
    done_when: [
      "✅ GET /tasks (filter status/priority/assignee/project/due-range/overdue, pagination) · POST /tasks (bắt buộc title; project optional task cá nhân) · GET/PATCH/DELETE /tasks/:id (delete = soft-delete deleted_at/by) · GET /tasks/my (assigned+created+watched, dedupe theo id, sort overdue-first) — TaskCoreController routes + TaskCoreService + TaskCoreRepository (raw sql cho cột 0478 chưa typed — schema/** ngoài path cho phép)",
      "✅ Data-scope: list/detail lọc DataScopeService (Own/Team/Company) + membership project (assignee-scope OR active-member EXISTS); assignee phải employee active + có tài khoản + trong phạm vi người giao (400/403 fail-loud); withTenant + company_id mọi query (raw sql bind company_id tường minh trên RLS+FORCE 0478)",
      "✅ task_activity_logs TASK_CREATED/UPDATED/DELETED target_type='Task' (append-only) + AuditService objectType='task'; DTO taskCore* APPEND contracts dual-build (KHÔNG rewrite export cũ); envelope API-01",
      "✅ Int-spec 13 xanh trên LANE_DB cô lập (task-core.int-spec.ts): data-scope emp/mgr/admin · cross-tenant 404 · out-of-scope 404 · my-tasks 3 nguồn+dedupe+overdue · deny create emp/mgr (deferred 0485) · assignee resigned/terminated/inactive/deleted/no-account 400 · workflow task PATCH/DELETE 400 · append-only ledger deny; typecheck xanh; tasks.permissions.spec cập nhật (getMyTasks nay gate read:task, delete:task sensitive)",
      "OUT-OF-SCOPE (WO nối tiếp): (a) FE web-core tasks-api.ts getMyTasks() gọi GET /tasks legacy shape → PHẢI chuyển GET /tasks/my (BREAKING — GET /tasks nay là list scoped + DTO taskCore* + gate read:task); (b) POST/DELETE watcher (watch:task seed 0485 dormant) — my-tasks CHỈ đọc watched, seed watcher qua SQL; (c) /tasks/board·by-project·by-team giữ pair-gate-only KHÔNG data-scope (gap S4-TASK-SEED-1); (d) update-status:task action riêng (S4-TASK-BE-3); (e) create/update:task cho emp/mgr vẫn HOÃN (TASK_DEFERRED_GRANTS) — 403 hôm nay ĐÚNG, scope-check đã impl fail-closed sẵn sàng khi grant mở",
    ],
  },
  {
    id: "S4-TASK-BE-3",
    module: "TASK",
    layer: "BE",
    title:
      "BE Task assignment + status workflow FSM (assign/đổi assignee, add/remove watcher, POST /:id/status transition hợp lệ, priority/deadline) — crown FSM, activity log, phát event NOTI",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/tasks/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
      "docs/plans/S4-TASK-BE-3.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-2"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-BE-004)",
      "API-06",
      "IMP02-STORY-070/071",
      "IMPLEMENTATION-07 §9.3/§9.4",
      "SPEC-06 (status FSM)",
    ],
    plan: "docs/plans/S4-TASK-BE-3.md",
    done_when: [
      "POST /tasks/:id/assign (giao/đổi assignee chính) · POST/DELETE /:id/watchers · POST /:id/status · POST /:id/priority · POST /:id/deadline — @RequirePermission đúng cặp; chỉ gán người trong scope/project; cảnh báo (không chặn cứng MVP) nếu assignee đang nghỉ phép duyệt",
      "FSM status hợp lệ: Todo→In Progress→In Review→Done/Cancelled (transition table tường minh, chặn nhảy trạng thái sai → mã lỗi SPEC-06); Done có thể đòi checklist hoàn thành nếu config bật; ghi task_activity_logs TASK_ASSIGNED/STATUS_CHANGED/PRIORITY_CHANGED/DUE_DATE_CHANGED",
      "Phát event chuẩn qua outbox theo Event code registry §9.5 (TASK_ASSIGNED/TASK_ASSIGNEE_CHANGED/TASK_STATUS_CHANGED/TASK_PRIORITY_CHANGED/TASK_DUE_DATE_CHANGED) — payload KHÔNG chứa dữ liệu nhạy cảm; wiring consumer thực ở S4-INT-1",
      "Int-spec RED-trước: transition không hợp lệ → 4xx + không đổi state · gán ngoài scope/tenant → deny · watcher trùng bị chặn · actor không tự nhận notify (chuẩn bị INT) · activity log ghi đúng; FULL gate security-reviewer + plan-reviewer PASS trước code (crown)",
      "GHI CHÚ ACCEPTANCE (plan-review 2026-07-11 OQ#1, PR #150): route THỰC = POST /:id/change-status · /change-priority · /change-deadline (verb canonical SPEC-06 §16.3/API-06 §14 — done_when dòng 1 là shorthand); watcher SELF-ONLY (không nhận employee_id body); QA map test theo tên canonical, KHÔNG báo lệch.",
    ],
  },
  {
    id: "S4-TASK-BE-4",
    module: "TASK",
    layer: "BE",
    title:
      "BE Kanban (board + move) + comment/mention + checklist + activity log (GET /projects/:id/kanban, POST /:id/move, comments CRUD, checklists/items, GET /:id/activity) — P1",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/src/tasks/**", "apps/api/test/integration/**", "packages/contracts/src/**"],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-3"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-BE-005)",
      "API-06",
      "IMP02-STORY-072/073/074",
      "IMPLEMENTATION-07 §9.2/§9.3",
    ],
    done_when: [
      "GET /projects/:id/kanban (board theo status) · POST /tasks/:id/move (đổi status qua FSM chung — tái dùng S4-TASK-BE-3, không lách FSM) · comments CRUD (POST/PATCH/DELETE soft, không rỗng, chỉ người xem được task) · POST /:id/checklists + items + PATCH tick · GET /:id/activity",
      "Mention: chỉ mention người có quyền xem task (ngoài scope → cảnh báo/không cho); comment/mention phát event TASK_COMMENT_CREATED/TASK_MENTIONED qua outbox. ⚠️ OWNER CHỐT 2026-07-09: mã mention = TASK_MENTIONED (KHÔNG phải TASK_COMMENT_MENTIONED) — phải TRÙNG KHÍT chuỗi seed ở S4-NOTI-SEED-1, lệch = catalog lookup miss = thông báo mention im lặng không bao giờ bắn.",
      "task_activity_logs COMMENT_CREATED/COMMENT_DELETED/CHECKLIST_CREATED/CHECKLIST_ITEM_DONE; withTenant + company_id; DTO contracts dual-build",
      "Int-spec RED-trước: comment/mention ngoài quyền bị chặn · kanban move trái quyền update-status → deny · checklist progress đúng; check.sh xanh + LIGHT gate",
    ],
  },
  {
    id: "S4-NOTI-DB-1",
    module: "NOTI",
    layer: "DB",
    title:
      "Schema + migration NOTI (notification_events·notification_templates·notifications·notification_delivery_logs) theo DB-07 — RLS+FORCE, partial index unread, delivery status",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-NOTI-DB-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-DB-1"],
    src: ["ISSUE-BOARD-01 §18 (NOTI-DB-001)", "DB-07", "SPEC-08", "IMPLEMENTATION-07 §8.2"],
    plan: "docs/plans/S4-NOTI-DB-1.md",
    done_when: [
      "Migration nối tiếp head (SAU S4-TASK-DB migrations, tuần tự): notifications (company_id, recipient_user_id, source_module, event_code, target_module/type/id/url, status Unread/Read/Hidden/Archived/Deleted, read/hidden/archived/deleted_at) · notification_events (event_code, module_code, enabled, dedupe_enabled, dedupe_window_seconds, recipient_resolver) · notification_templates (channel, locale, title/short/content_template, variables_schema, status) · notification_delivery_logs (status, retry_count, error_message) append-only",
      "BẤT BIẾN #1: RLS ENABLE+FORCE + policy company_id mọi bảng; đăng ký rls-registry; notification_delivery_logs append-only (app role REVOKE UPDATE/DELETE)",
      "Partial index unread-count (company_id, recipient_user_id) WHERE status='Unread'; index list theo recipient + created_at",
      "RECONCILE: đối chiếu module cũ apps/api/src/notifications (device-token/preferences/push-sender) — giữ phần khớp DB-07, park push/device nếu ngoài phạm vi IN_APP MVP; migration additive, KHÔNG drop",
      "Int-spec RED-trước lane DB: cross-tenant deny notifications + append-only delivery_logs; migration-smoke xanh; FULL gate database-reviewer + rls-tenant-isolation-tester PASS",
    ],
  },
  {
    id: "S4-NOTI-SEED-1",
    module: "NOTI",
    layer: "DB",
    title:
      "Seed notification event catalog (Event code registry §9.5 canonical) + template IN_APP tiếng Việt + permission NOTI + role mapping idempotent",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/foundation/seed/**",
      "apps/api/migrations/**",
      "docs/plans/S4-NOTI-SEED-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-DB-1"],
    src: [
      "ISSUE-BOARD-01 §18 (NOTI-DB-002)",
      "IMPLEMENTATION-07 §8.4/§9.5/§10.4",
      "IMP02-STORY-077",
      "SPEC-08",
    ],
    plan: "docs/plans/S4-NOTI-SEED-1.md",
    done_when: [
      "OWNER CHỐT 2026-07-09 — mã event mention = TASK_MENTIONED (KHÔNG phải TASK_COMMENT_MENTIONED). Lý do: docs/DB + docs/spec là chuẩn (CLAUDE.md) và DB-07 (3), SPEC-06 (2), SPEC-08 (3/4) đều dùng TASK_MENTIONED; chuỗi TASK_COMMENT_MENTIONED chỉ đến từ IMPLEMENTATION-07 và ĐÃ được rename toàn bộ về TASK_MENTIONED. Seed và producer S4-TASK PHẢI dùng CÙNG chuỗi — lệch = catalog lookup miss = thông báo mention IM LẶNG không bao giờ bắn.",
      "Seed notification_events theo Event code registry §9.5. LẤY DANH SÁCH MÃ ĐẦY ĐỦ TỪ SPEC-08 + DB-07 (đọc file, KHÔNG suy từ shorthand gạch chéo — tiền tố TASK_ dễ rơi mất). ĐÃ XÁC MINH 2 mã hay drift: TASK_COMMENT_CREATED (SPEC-08 ×2, DB-07 ×1, SPEC-06 ×2) và TASK_MENTIONED. Event chưa bật MVP để enabled=false (KHÔNG bỏ khỏi catalog). Liệt kê nguyên văn từng event_code trong plan để reviewer đối chiếu.",
      "Seed template IN_APP cho mọi event enabled=true (§10.4: title + short_template + variables_schema); ON CONFLICT DO NOTHING. locale = 'vi-VN' (ĐÚNG default + index của mig 0479 dòng 105), KHÔNG phải 'vi'. body_template NOT NULL (0479:107) ⇒ set tường minh; status='Active' + is_default=true để resolver findEnabled chọn được (mặc định schema là 'Draft').",
      "OWNER CHỐT 2026-07-09 — permission NOTI: PIN thành tuple (action, resource_type) TƯỜNG MINH theo convention lowercase của mig 0005, liệt kê từng cặp trong plan; phải khớp 3 nơi: seed THẬT ↔ cặp FE registry.ts map ↔ cặp NOTI-BE @RequirePermission (bài học pair-drift s1-fnd-module/s3-fe). BỎ cặp 'channel' — phantom, grep CHANNEL trong DB-02 §9.7 = 0 kết quả, và chính plan ghi out-of-scope 'KHÔNG tạo channel-config table'. Chỉ seed CONFIG.VIEW/UPDATE + TEMPLATE.VIEW/UPDATE + DELIVERY_LOG.VIEW (+AUDIT_LOG.VIEW nếu §9.7 có).",
      "OWNER CHỐT 2026-07-09 — HR KHÔNG nhận NOTI.CONFIG/NOTI.TEMPLATE. Chỉ company-admin + super-admin có config; HR chỉ có own-notification như mọi user (least-privilege). Int-spec phải assert HR KHÔNG có cặp config.",
      "Grant role-permission: enumerate TƯỜNG MINH mảng role slug (mirror 0480:62-66) — KHÔNG suy đoán. DO-block phải RAISE EXCEPTION fail-LOUD khi role của GRANT thiếu (mirror 0480:79-81), KHÔNG dùng CONTINUE im lặng như block park — nếu không, seed 0 row mà không ai biết.",
      "Int-spec: seed idempotent chạy lại; event/template khớp registry (không mã lạ); admin thấy cặp config NOTI qua /auth/me; HR + employee KHÔNG có cặp config (deny-path). POSITIVE test BẮT BUỘC: MỖI role canonical (employee/manager/hr/company-admin/super-admin) thực sự NHẬN được own-notification @Own qua getCapabilities — deny-path một mình KHÔNG bắt được lỗi grant 0 row.",
      "Bảng notification_events/templates tạo ở mig 0479 với company_id NULLABLE (NULL = global) và app role chỉ có SELECT ⇒ seed global rows PHẢI chạy qua table-owner (migration), KHÔNG qua app role.",
      "Gate int-spec = hasDb && LANE_DB (chỉ .env → hasDb=true = đỏ-giả). SỐ MIGRATION: chạy `ls apps/api/migrations/*.sql | tail -1` ngay trước khi tạo file, KHÔNG hard-code. FULL gate security-reviewer + database-reviewer PASS",
    ],
  },
  {
    // Nợ từ plan-review S4-TASK-BE-3 (PR #150, 2026-07-11): catalog 0481 LỆCH Event code registry §9.5 —
    // thiếu TASK_PRIORITY_CHANGED; seed TASK_DEADLINE_CHANGED ≠ canonical TASK_DUE_DATE_CHANGED;
    // TASK_ASSIGNEE_CHANGED enabled=false + không template. BE-3 phát mã CANONICAL ⇒ không vá trước INT-1
    // = catalog lookup miss = notification priority/deadline IM LẶNG (đúng lớp bug TASK_MENTIONED).
    id: "S4-NOTI-SEED-2",
    module: "NOTI",
    layer: "DB",
    title:
      "Vá catalog notification_events khớp registry §9.5 cho event TASK (BE-3): thêm TASK_PRIORITY_CHANGED · đổi TASK_DEADLINE_CHANGED→TASK_DUE_DATE_CHANGED · template + enable TASK_ASSIGNEE_CHANGED — BẮT BUỘC TRƯỚC S4-INT-1",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/migrations/**",
      "docs/plans/S4-NOTI-SEED-2.md",
      "apps/api/src/foundation/seed/**",
      "apps/api/test/integration/noti-seed-catalog-permissions.int-spec.ts",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-3"],
    src: [
      "IMPLEMENTATION-07 §9.5 (Event code registry — nguồn canonical)",
      "mig 0481 (catalog hiện trạng, dòng 78-97)",
      "docs/plans/S4-TASK-BE-3.md §4 + §11 ĐK-2 (đối chiếu drift đã verify)",
      "PR #150 (payload thật BE-3 phát)",
    ],
    done_when: [
      "Migration đánh số nối tiếp head THẬT (`ls apps/api/migrations/*.sql | tail -1` ngay trước khi tạo — KHÔNG hard-code): INSERT event TASK_PRIORITY_CHANGED idempotent (ON CONFLICT DO NOTHING); xử lý TASK_DEADLINE_CHANGED→TASK_DUE_DATE_CHANGED bằng UPDATE code trên row hiện có NẾU chưa có row canonical + không FK nào trỏ tới (kiểm notifications tham chiếu trước); nếu đã có cả hai → giữ canonical, disable row cũ. KHÔNG DELETE (append-safe).",
      "Template IN_APP cho TASK_PRIORITY_CHANGED / TASK_DUE_DATE_CHANGED / TASK_ASSIGNEE_CHANGED mirror chuẩn 0481: locale 'vi-VN' (KHÔNG 'vi'), body_template NOT NULL, status='Active', is_default=true; enable (is_enabled=true) cho 3 mã này; các mã khác GIỮ NGUYÊN trạng thái",
      "variables_schema khớp payload THẬT BE-3 phát (đọc task-actions.service.ts: taskId/taskTitle/taskCode/actorUserId/fromStatus/toStatus/oldPriority/newPriority/oldDueAt/newDueAt) — đối chiếu code, không suy đoán",
      "Int-spec (gate hasDb && LANE_DB): catalog sau migrate có ĐỦ 5 mã canonical §9.5 của BE-3 ở trạng thái enabled + resolver template tìm được từng mã; chạy lại idempotent; FULL gate security-reviewer + database-reviewer PASS",
      "SHIPPED (mig 0490, idx 170, when 1717500845000 — reserve gap idx 169/0489 nhánh HR): registry notification-event-catalog.const.ts đồng bộ 1-1 (52→53 event / 36→39 enabled); pin seed-1 spec 53/39; noti-seed-catalog-permissions.int-spec + noti-seed2-be3-catalog.int.spec + noti-event-intake XANH trên LANE_DB=mediaos_notiseed2; VÁ render 0481 TASK_ASSIGNED/TASK_STATUS_CHANGED snake→camelCase (STATUS dùng toStatus); Engine E2E TASK_PRIORITY_CHANGED createdCount≥1 fallback=false; append-safe (DEADLINE rename in-place, KHÔNG DELETE), RLS+FORCE nguyên vẹn",
    ],
  },
  {
    id: "S4-NOTI-BE-1",
    module: "NOTI",
    layer: "BE",
    title:
      "BE My-notification APIs (GET /notifications, /dropdown, /unread-count, /:id, POST /:id/mark-read, /mark-all-read, DELETE /:id) — own-scope tuyệt đối, unread dùng partial index",
    // zone red (sửa 2026-07-09): WO này CHẠM permission — mig 0483 chuẩn hoá delete:notification về
    // Own-scope (expand cho employee/manager/hr, contract cho company-admin vốn có @Company từ bulk-grant
    // 0005:310-313). Khai yellow + paths thiếu migrations/** đã khiến auto-loop route nó vào LIGHT gate.
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/notifications/**",
      "apps/api/src/realtime/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-SEED-1"],
    src: [
      "ISSUE-BOARD-01 §18 (NOTI-BE-003/004)",
      "API-07",
      "IMP02-STORY-079/081",
      "IMPLEMENTATION-07 §10.2/§10.3",
    ],
    done_when: [
      "GET /api/v1/notifications (list của TÔI, pagination) · /dropdown (latest N) · /unread-count (partial index, không scan bảng) · /:id · POST /:id/mark-read · /mark-all-read · DELETE /:id (soft, của tôi) — MỌI query filter company_id + recipient_user_id = user hiện tại",
      "Mark read idempotent + chỉ áp dụng notification của chính mình; mark-all-read + delete phát NOTIFICATION_READ để DASH invalidate (chuẩn bị INT); notification deleted/hidden không hiện list mặc định",
      "DTO contracts dual-build; envelope chuẩn API-01; loading/empty/error để FE dùng",
      "Int-spec RED-trước: user A KHÔNG đọc/mark notification user B (cross-user + cross-tenant deny) · unread-count đúng sau mark-read · mark của người khác → 403/404; check.sh xanh + LIGHT gate",
    ],
  },
  {
    id: "S4-NOTI-BE-2",
    module: "NOTI",
    layer: "BE",
    title:
      "BE Event intake + notification engine (POST /internal/v1/notifications/events + /send) — recipient resolver, template renderer, delivery log, dedupe, actor-exclusion — crown trust boundary",
    zone: "red",
    status: "todo",
    // paths hẹp có chủ đích: conflict() của auto-loop so prefix tĩnh của glob, nên "test/integration/**"
    // sẽ bị coi là đụng int-spec của WO khác ⇒ mất song song. WO này chỉ viết đúng 1 int-spec.
    paths: [
      "apps/api/src/notifications/**",
      "apps/api/src/events/**",
      "apps/api/test/integration/noti-event-intake.int-spec.ts",
      "packages/contracts/src/**",
      "docs/plans/S4-NOTI-BE-2.md",
    ],
    skills: ["code-review"],
    // PR #133 sửa notifications.module.ts + notifications.controller.ts → phải rebase sau khi #133 merge.
    depends_on: ["S4-NOTI-SEED-1", "S4-NOTI-BE-1"],
    src: [
      "ISSUE-BOARD-01 §18 (NOTI-BE-001/002)",
      "API-07",
      "IMP02-STORY-078",
      "IMPLEMENTATION-07 §10.1/§10.3",
      "SPEC-08",
    ],
    plan: "docs/plans/S4-NOTI-BE-2.md",
    done_when: [
      "ĐỌC docs/plans/S4-NOTI-BE-2.md §0 TRƯỚC KHI CODE — plan v1 bị plan-reviewer BLOCK, v2 đã sửa 3 lỗi. Đừng lặp lại.",
      "SCOPE THU HẸP: chỉ làm POST /internal/v1/notifications/events. Route POST /send + internalDirectSendSchema ĐẨY SANG S4-NOTI-BE-3 (đường direct-send bỏ qua event catalog, admin tự soạn title/body/target_url → bề mặt rủi ro cao hơn /events, xứng đáng WO riêng có test riêng)",
      "Internal event intake tiêu thụ event: resolve event catalog → recipient resolver (LOẠI actor trừ is_system_event) → render template theo locale → tạo notification IN_APP + delivery log. Trust boundary: JwtAuthGuard toàn cục (KHÔNG @Public) + InternalGuard (x-internal-key; env unset → 403 fail-closed); company_id LẤY TỪ TOKEN, body khác token → 400",
      "DEDUPE PHẢI BỌC SAVEPOINT MỖI RECIPIENT. Postgres abort cả transaction khi unique-violation — bắt lỗi 23505 ở tầng JS trong CÙNG tx sẽ làm mọi lệnh sau ném 'current transaction is aborted', mất notification của recipient khác hoặc bật 500. Dùng SAVEPOINT sp_recipient + ROLLBACK TO khi 23505 → deduped_count++, tx ngoài sống. Ép 2 tầng: app query isDuplicate + backstop partial-unique uq_notifications_dedupe_active",
      "createFromEngine PHẢI dual-write: cột MỚI (recipient_user_id, event_code, dedupe_key, status='Unread', ...) VÀ cột legacy NOT NULL (user_id, body, type='general', is_read=false). Index uq_notifications_dedupe_active đánh trên (company_id, recipient_user_id, event_code, dedupe_key) — toàn cột MỚI; bỏ chúng NULL thì partial-unique coi NULL là distinct ⇒ dedupe hỏng IM LẶNG. Quên cột legacy thì INSERT fail",
      "notification_delivery_logs chỉ GRANT SELECT,INSERT → engine INSERT-terminal ('Sent'/'Skipped'/'Failed'), CẤM UPDATE trạng thái. 'Event disabled → delivery_log Skipped' BẤT KHẢ THI (FK notification_id NOT NULL) → event-level skip ghi audit_logs 'notification_skipped'; delivery_log Skipped chỉ dùng cho channel/recipient-level. Mọi event seed 0481 có dedupe_strategy='None' → dùng DEFAULT_DEDUPE const cho TASK_COMMENT_CREATED/TASK_STATUS_CHANGED, catalog override được",
      "Target URL phải là route nội bộ (bắt đầu '/', chặn scheme http:/https:/javascript:/data: và '//') → ngoài whitelist reject 422 NOTI-ERR-TARGET-UNAVAILABLE. Payload chứa key nhạy cảm (password/token/salary/bank_account/identity_number) → 400. /events là fire-and-forget: disabled/dedupe trả 200 + summary, KHÔNG ném lỗi ⇒ 422 EVENT-DISABLED và 409 DEDUPE-CONFLICT thuộc /send (BE-3), không khai ở BE-2 (mã treo không có deny-path)",
      "KHÔNG wiring TASK→NOTI (S4-INT-1) — test bằng event giả qua HTTP intake. KHÔNG đăng ký consumer eventType TASK. Mỗi file ≤400 dòng: tách engine/resolver/renderer/dedupe",
      "Int-spec RED-trước, deny-path đi đầu, gate `hasDb && LANE_DB`: (a) không JWT→401, thiếu/sai x-internal-key→403, env unset→403 · (b) dedupe chặn trùng trong window, cho qua bucket kế · (b2) chèn TRƯỚC row xung đột qua directPool rồi intake 2 recipient: recipient trùng → deduped, recipient còn lại VẪN được tạo, KHÔNG 500; assert notification có recipient_user_id/event_code/dedupe_key NOT NULL · (c) actor không tự nhận notify, is_system_event thì có · (d) recipient company khác → không tạo; body.company_id≠token → 400 · (e) event disabled → 0 notification + 0 delivery_log + audit skip, KHÔNG 500 · (f) template missing → fallback non-silent · (g) target URL ngoài → 422. FULL gate security-reviewer + silent-failure-hunter + database-reviewer PASS",
    ],
  },
  {
    id: "S4-NOTI-BE-3",
    module: "NOTI",
    layer: "BE",
    title:
      "BE Notification admin config (GET events/templates/delivery-logs, PATCH bật/tắt event, cập nhật template) + reminder job TASK_DUE_SOON/TASK_OVERDUE — P1/P2",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/src/notifications/**",
      "apps/api/src/scheduler/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-BE-2"],
    src: [
      "ISSUE-BOARD-01 §18 (NOTI)",
      "API-07",
      "IMPLEMENTATION-07 §10.2 (P2) / §8.4 (reminder)",
      "SPEC-08",
    ],
    done_when: [
      "⚠️ CAP-2 (bug đã tái diễn 3 lần: CAP-2/USEROPS-1/EXPORT-1) — 6 cặp config NOTI seed ở mig 0481 đều is_sensitive=true nên KHÔNG surface qua getCapabilities ⇒ nút cấu hình sẽ ẨN với CẢ admin. WO này PHẢI append 6 cặp vào SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts): view/update:notification-config · view/update:notification-template · view:notification-delivery-log · view:notification-audit-log. Có test khẳng định admin THẤY đủ 6 cặp qua /auth/me.",
      "@RequirePermission dùng ĐÚNG tuple đã pin: 6 cặp config trên + own-scope NOTI_OWN_ACTIONS (read/mark_read/mark_all_read/hide : notification) trong apps/api/src/foundation/seed/notification-event-catalog.const.ts. Lệch một ký tự = 403 im lặng.",
      "GET /notifications/events · PATCH /events/:id (bật/tắt) · GET/PATCH /templates/:id · GET /delivery-logs — @RequirePermission config NOTI (admin); mọi query company-scoped; audit khi đổi cấu hình",
      "Reminder job TASK_DUE_SOON (sắp đến hạn) + TASK_OVERDUE (quá hạn) mức scheduled cơ bản qua scheduler hiện có: quét task đến hạn → phát event registry §9.5 → intake S4-NOTI-BE-2 tạo notification cho assignee (+manager nếu cấu hình overdue); idempotent, không gửi trùng trong ngày",
      "DTO contracts dual-build; job chạy lại an toàn (dedupe theo entity+ngày)",
      "Int-spec: employee không config được (403) · job phát đúng recipient · không gửi trùng; check.sh xanh + LIGHT gate",
    ],
    // PHIÊN 2026-07-10 (lane notibe3) — SHIP MỘT PHẦN, CÒN LẠI BLOCKED (needs_human):
    //   Đã xong: (1) CAP-2 fix — 6 cặp NOTI config APPEND vào SENSITIVE_CAPABILITY_ALLOWLIST
    //   (permission.service.ts) + test /auth/me (auth-me-capabilities.int.spec.ts, describe S4-NOTI-BE-3).
    //   (2) GET /notifications/events (list, filter module_code/event_code/enabled/search) · GET
    //   /notifications/templates/:id (chi tiết) · GET /notifications/delivery-logs (list) —
    //   notification-admin.controller.ts, @RequirePermission đúng 3/6 cặp view (config/template/
    //   delivery-log). (3) Reminder job TASK_DUE_SOON/TASK_OVERDUE — task-reminder.job-handler.ts
    //   (@SystemJobHandler, quét tasks task_type='office'), dedupe idempotent qua DEFAULT_DEDUPE
    //   'DedupeKey' (notification-dedupe.const.ts) — dedupeKey="<taskId>:<ngày UTC>". Test:
    //   notification-admin-config.int-spec.ts + task-reminder-job.int-spec.ts (RED-trước xác nhận).
    //
    //   BLOCKED (KHÔNG làm được trong lane này — cấm tạo migration): PATCH /notifications/events/:id
    //   (bật/tắt event) + PATCH /notifications/templates/:id (sửa template). Ghi company-override đòi
    //   GRANT INSERT,UPDATE MỚI trên notification_events/notification_templates cho mediaos_app — hiện
    //   CHỈ có GRANT SELECT (migration 0479/0481/0482, comment sẵn "write company-override →
    //   S4-NOTI-BE-3"). Đây là DDL (GRANT), không biểu diễn được bằng code app — cần 1 migration nối
    //   tiếp head (band kế 0486+) TRƯỚC khi 1 lane BE khác build 2 route PATCH này. update:notification-
    //   template cũng cần validate biến cấm (password/salary/token/…) theo API-07 §14.3 business rule #6
    //   khi implement PATCH thật.
    //   THỨ TỰ ĐÚNG: (a) migration nhỏ GRANT INSERT,UPDATE ON notification_events, notification_templates
    //   TO mediaos_app (KHÔNG đổi RLS — policy nullable-tenant 0479 đã cho WITH CHECK company_id=GUC) →
    //   (b) WO PATCH kế thừa notification-admin.controller.ts (đã có scaffold GET + tuple pin) thêm 2 route
    //   PATCH + audit (object_type 'notification' tái dùng, KHÔNG cần CHECK mới).
  },
  {
    id: "S4-NOTI-BE-4",
    module: "NOTI",
    layer: "BE",
    title:
      "NOTI admin config WRITE: migration GRANT-only (INSERT,UPDATE notification_events + notification_templates cho app role) + PATCH /notifications/events/:id (bật/tắt) + PATCH /templates/:id — hoàn tất phần blocked của S4-NOTI-BE-3",
    zone: "red",
    status: "done",
    // PHIÊN 2026-07-11 (lane notibe4) — SHIP: mig 0487 (GRANT INSERT,UPDATE app trên notification_events +
    //   notification_templates; KHÔNG DDL khác, KHÔNG đổi RLS, KHÔNG DELETE). PATCH /notifications/events/:id
    //   (bật/tắt = INSERT company-override; KHÔNG UPDATE row global) + PATCH /notifications/templates/:id (sửa
    //   nội dung = company-override). Rẽ nhánh theo sourceRow.companyId (KHÔNG suy theo id lẻ); SAVEPOINT chống
    //   đua 23505. assertTemplateVariablesSafe (placeholder {password}/{token}/… → 422 TRƯỚC khi chạm DB).
    //   Audit (object_type 'notification', action notification_config_updated/notification_template_updated)
    //   CÙNG withTenant tx với upsert. Int-spec RED-trước: notification-admin-write.int-spec.ts (7 test — migration
    //   smoke grant/RLS · employee 403 · toggle 2 chiều · biến cấm 422 · override hợp lệ · cross-tenant B · 404).
    //   14/14 test 2 file admin xanh trên mediaos_notibe4.
    paths: [
      "apps/api/migrations/**",
      "apps/api/src/notifications/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-BE-3"],
    src: [
      "Ghi chú inline S4-NOTI-BE-3 (phiên 2026-07-10 — lý do blocked + thứ tự đúng, ngay phía trên)",
      "apps/api/src/notifications/notification-admin.controller.ts (scaffold GET + tuple pin sẵn)",
      "API-07 §14.3 (business rule #6 — biến cấm trong template)",
      "migrations 0479/0481/0482 (comment 'write company-override → S4-NOTI-BE-3', GRANT SELECT-only)",
    ],
    done_when: [
      "Migration đánh số nối tiếp head thật (đọc apps/api/migrations/meta/_journal.json lấy idx/when thật, when +5000): CHỈ `GRANT INSERT, UPDATE ON notification_events, notification_templates TO mediaos_app` — KHÔNG DDL khác, KHÔNG đổi RLS/policy (policy nullable-tenant 0479 đã WITH CHECK company_id=GUC — verify lại trước khi tin), KHÔNG grant DELETE (config là toggle/override, không xoá)",
      "PATCH /notifications/events/:id (bật/tắt = ghi company-override row, TUYỆT ĐỐI KHÔNG UPDATE row global company_id IS NULL) + PATCH /notifications/templates/:id trên scaffold notification-admin.controller.ts; @RequirePermission update:notification-config / update:notification-template — tuple đã pin trong notification-event-catalog.const.ts và ĐÃ nằm trong SENSITIVE_CAPABILITY_ALLOWLIST từ BE-3, KHÔNG append thêm",
      "PATCH template validate biến cấm theo API-07 §14.3 rule #6 (password/salary/token/…): payload chứa biến cấm → 422, KHÔNG ghi DB",
      "Audit log khi đổi cấu hình (tái dùng object_type 'notification' — KHÔNG cần migration CHECK mới); withTenant mọi query; DTO contracts dual-build",
      "Int-spec RED-trước (gate hasDb && LANE_DB): employee PATCH → 403 · admin toggle event → GET events phản ánh override còn row global KHÔNG đổi · template biến cấm → 422 · cross-tenant: override company A không rò sang company B; FULL gate security-reviewer + database-reviewer PASS",
    ],
  },
  {
    id: "S4-DASH-DB-1",
    module: "DASH",
    layer: "DB",
    title:
      "Schema + migration DASH (dashboard_widgets·dashboard_widget_configs·dashboard_widget_cache) theo DB-07 — RLS+FORCE, cache không lưu dữ liệu nhạy cảm chưa mask",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/db/schema/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-DASH-DB-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-DB-1"],
    src: ["ISSUE-BOARD-01 §18 (DASH-DB-001)", "DB-07", "SPEC-07", "IMPLEMENTATION-07 §8.3"],
    plan: "docs/plans/S4-DASH-DB-1.md",
    done_when: [
      "⚠️ NEO `when` VÀO HEAD THẬT — head hiện tại là 0480_s4_taskrecon1_task_pair_drift_grants (journal idx 160, when 1717500795000), KHÔNG phải 0479. Migration mới = 0481, idx 161, when ≥ 1717500800000 (giữ bước +5000). Nếu đặt when vào khoảng (1717500790000, 1717500795000] thì journal MẤT ĐƠN ĐIỆU: trên lane DB tươi (áp theo thứ tự mảng) migration-smoke vẫn XANH = xanh-giả, nhưng trên DB đã áp 0480 (dev-online/prod) drizzle áp theo `when` đơn điệu ⇒ BỎ QUA 0481 ⇒ 3 bảng dashboard không được tạo ⇒ 500 runtime (memory dev-online-db-migration-drift). Đọc apps/api/migrations/meta/_journal.json để lấy idx/when thật trước khi tạo file.",
      "Migration nối tiếp head (SAU S4-NOTI-DB + S4-TASK-RECON-1, tuần tự): dashboard_widgets (widget_code, widget_name, widget_type, source_modules, required_permission, status) · dashboard_widget_configs (config theo company/role/user/dashboard_type) · dashboard_widget_cache (cache_key, widget_code, dashboard_type, data, expires_at)",
      "BẤT BIẾN #1: bảng company-scoped ENABLE+FORCE RLS + policy company_id; đăng ký rls-registry; index (company_id, dashboard_type, widget_code, expires_at)",
      "Cache KHÔNG lưu dữ liệu nhạy cảm ngoài scope hoặc chưa mask (ghi rõ constraint/policy); cache_key gồm company + dashboard_type + widget_code + user/scope khi data theo user",
      "RECONCILE: đối chiếu module cũ apps/api/src/dashboard (mv-dashboard/report/alerts) — giữ phần khớp DB-07, park report/mv nếu ngoài phạm vi widget MVP; migration additive",
      "Int-spec RED-trước lane DB: cross-tenant deny widget config/cache; migration-smoke xanh; FULL gate database-reviewer + rls-tenant-isolation-tester PASS",
    ],
  },
  {
    id: "S4-DASH-SEED-1",
    module: "DASH",
    layer: "DB",
    title:
      "Seed widget catalog 7 In-sprint (§11.3) + permission DASH + default config theo Employee/Manager/HR/Admin idempotent",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/dashboard/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts",
      "docs/plans/S4-DASH-SEED-1.md",
    ],
    skills: ["code-review"],
    // PR #133 (S4-NOTI-BE-1) mint mig 0483. WO này phải rebase SAU khi #133 merge rồi mới đánh số 0484.
    depends_on: ["S4-DASH-DB-1", "S4-NOTI-BE-1"],
    src: [
      "ISSUE-BOARD-01 §18 (DASH-DB-002)",
      "IMPLEMENTATION-07 §8.4/§11.3",
      "IMP02-STORY-085",
      "SPEC-07",
      "DB-07 §8.5/§10.2",
    ],
    plan: "docs/plans/S4-DASH-SEED-1.md",
    done_when: [
      "ĐỌC docs/plans/S4-DASH-SEED-1.md §0 TRƯỚC KHI CODE — plan v1 VÀ v2 đều bị plan-reviewer BLOCK. v3 đã sửa 8 lỗi. Đừng lặp lại.",
      "4 LANE CHẠY TUẦN TỰ, KHÔNG FAN-OUT: dashCatalogConst → dashSeedMig → dashConfigSeeder → dashSeedVerify. Chạy song song sẽ cho GREEN GIẢ: seeder trước migration thì thiếu widgets + thiếu GRANT INSERT; hai lane cùng chạm meta/_journal.json thì mint trùng số",
      "OWNER CHỐT (Option B — gate widget bằng quyền MODULE NGUỒN): KHÔNG seed cặp engine per-widget ('*:dashboard-widget'). required_permission_code lưu chuỗi SPEC verbatim 'DASH.WIDGET.VIEW_*'; gate thật đi qua DASH_WIDGET_GATE_PAIR. Cặp đã xác minh tồn tại: ATTENDANCE_TODAY→view-own:attendance (0454) · MY_TASKS/TASK_ALERTS→read:task (0005) · NOTIFICATIONS→read:notification (0005) · PENDING_LEAVE→view:leave (0455) · PROJECT_PROGRESS→read:project (0005:223, CHỐT CỨNG, KHÔNG read:task) · HR_OVERVIEW→read:employee (0019). CẢNH BÁO: nhiều module có NHIỀU cặp cùng tồn tại (ATT có CẢ read:attendance ở 0063 LẪN view-own:attendance; LEAVE có 3 cặp) nên test E3 chỉ chứng 'cặp tồn tại', KHÔNG bắt được cặp có-thật-sai-ngữ-nghĩa → mỗi entry phải kèm comment trỏ migration:dòng + lý do, reviewer đối chiếu bằng mắt",
      "Seed dashboard_widgets đúng 7 widget In-sprint §11.3: ATTENDANCE_TODAY, MY_TASKS, TASK_ALERTS, NOTIFICATIONS, PENDING_LEAVE, PROJECT_PROGRESS, HR_OVERVIEW; widget Catalog-only KHÔNG seed. Widgets GLOBAL (company_id NULL) → ghi qua migrator owner-bypass",
      "OWNER CHỐT 2026-07-10: seed ĐÚNG 7 cặp quyền DASH mới — view-employee/manager/hr/admin:dashboard · view:dashboard-config · update:dashboard-config · view:dashboard-audit-log. KHÔNG seed 'refresh:dashboard-cache': DASH.CACHE.REFRESH chỉ có ở SPEC-07 §8.2, mà chính header SPEC-07 ghi 'DN-7 ... seed DB-07 §10.2/API-10 cần lane khác cập nhật' và 'khi mâu thuẫn, lấy DB-07/API-08 làm chuẩn'; DB-07 §10.2 + permission-matrix-spec đều KHÔNG có nó. Seed bây giờ = quyền phantom không deny-path. GIỮ NGUYÊN 'read:dashboard' (mig 0100). Chỉ enumerate 4 role canonical — super-admin KHÔNG enumerate (sẽ RAISE)",
      "Test M (grant-matrix VÉT CẠN) phải đi ĐẦU, thay cho E1+D: với TỪNG role trong {employee, manager, hr, company-admin} assert tập (action,resource_type,data_scope) DASH bằng ĐÚNG ma trận §2.6, VÀ assert vắng mặt mọi cặp admin-only {view-admin:dashboard, view:dashboard-config, update:dashboard-config, view:dashboard-audit-log} mà role đó không được cấp. Lý do: v2 chỉ deny employee+manager, BỎ SÓT role 'hr' — role trung-quyền dễ leo thang nhất; DO-block lỡ grant nhầm hr thì toàn bộ suite vẫn XANH",
      "Migration đánh số nối tiếp head THẬT — ĐỌC meta/_journal.json chứ đừng tin số trong plan. Sau khi PR #133 merge, head = idx 163 / 0483_s4_notibe1_delete_own_grant ⇒ file mới 0484, idx 164, when 1717500815000. ON CONFLICT chỉ dùng target CÓ THẬT: widgets = uq_dashboard_widgets_global_code_active; permissions = (action,resource_type); role_permissions = (role_id,permission_id,effect). dashboard_widget_configs KHÔNG có unique index → BẮT BUỘC WHERE NOT EXISTS. Đổi data_scope grant = DELETE per-pair + INSERT (trên role_permissions)",
      "Mig chỉ 'GRANT INSERT ON dashboard_widget_configs TO mediaos_app' — KHÔNG DELETE, KHÔNG UPDATE. Lý do: bảng anh em dashboard_widget_cache (0482:231-232) cố ý không cấp DELETE với comment 'KHÔNG DELETE (BẤT BIẾN #2 soft-delete)'; configs cũng có deleted_at; và master-data-seeder.types.ts:15 ghi 'Seeder CHỈ làm INSERT'. Rút config default về sau = soft-delete UPDATE deleted_at, thuộc S4-DASH-BE",
      "Seeder + registrar đặt TRONG module DASH (apps/api/src/dashboard/dashboard-config.seeder.ts + dash-seed.registrar.ts), tự register vào MasterDataSeederRegistry ở onModuleInit — mirror attendance/att-seed.registrar.ts. TUYỆT ĐỐI KHÔNG sửa foundation/seed/seed.module.ts (INVERSION OF DEPENDENCY: foundation không import module nghiệp vụ). seedKey='dash.default-configs', seedVersion='v1' (đúng convention att-master-data.seeder.ts:30, KHÔNG phải '1'). Default configs seed post-boot vì company mặc định chỉ tồn tại sau BOOT",
      "Mệnh đề WHERE NOT EXISTS của seeder phải khoá trên (company_id, widget_id, dashboard_type, config_scope, role_id IS NULL, user_id IS NULL). Chỉ so (company_id, widget_id) sẽ chặn nhầm khi một widget xuất hiện ở nhiều dashboard_type (MY_TASKS có ở cả Employee lẫn Manager). Test F phải assert CẢ count KHÔNG đổi LẪN không phát sinh row trùng khoá nghiệp vụ",
      "Int-spec RED-trước, deny-path đi đầu, gate `hasDb && LANE_DB`: (M grant-matrix vét cạn — xem done_when riêng, ĐI ĐẦU) · (E2) KHÔNG tồn tại cặp '*:dashboard-widget' và KHÔNG tồn tại 'refresh:dashboard-cache' · (E3 chống pair-drift) MỖI giá trị DASH_WIDGET_GATE_PAIR resolve ra row (action,resource_type) THẬT · catalog == đúng 7 widget · (F) seed lại 2-3 lần idempotent, data_scope không drift · (H) admin thấy cặp DASH qua /auth/me · (I cross-tenant) PHẢI plant company thứ 2 + 1 config row thật rồi assert vắng mặt dưới GUC company A — ở N=1 không plant thì test xanh-giả. FULL gate security-reviewer + database-reviewer PASS; bật santa-method cho lane dashCatalogConst",
      "BÀN GIAO bắt buộc ghi vào PR: (1) gate widget = DASH_WIDGET_GATE_PAIR, KHÔNG phải required_permission_code — S4-DASH-BE-1/2 dễ nhầm vì hai khái niệm quyền chạy song song · (2) 4 cặp view-*:dashboard mới cần map trong packages/web-core PERMISSION_CODE_TO_PAIR nếu S4-FE-DASH-2 gate theo chúng, nếu không app sẽ ẩn (pair-drift đã cắn S3) · (3) refresh:dashboard-cache còn nợ: cập nhật DB-07 §10.2 rồi mới seed, WO riêng",
    ],
  },
  {
    id: "S4-DASH-CATALOG-2",
    module: "DASH",
    layer: "DB",
    title:
      "Bù đủ catalog widget DASH (11 widget còn lại của DB-07 §14.3) + reconcile mâu thuẫn nội bộ DB-07 §8.5 ↔ §14.3 + cặp refresh:dashboard-cache",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/dashboard/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts",
      "docs/DB/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-DASH-SEED-1", "S4-DASH-BE-2"],
    src: [
      "docs/DB/DB-07 §14.3 (khối DRIFT do S4-DASH-SEED-1 ghi)",
      "docs/DB/DB-07 §8.5 (chỉ 12 widget có required_permission_code)",
      "docs/API Design/API-10 PERMISSION MATRIX.md:288-313",
      "docs/plans/S4-DASH-SEED-1.md §2.5",
    ],
    done_when: [
      "BỐI CẢNH: S4-DASH-SEED-1 (mig 0484) chỉ seed 7 widget in-sprint. DB-07 §14.3 còn 11 widget: LEAVE_BALANCE, TEAM_TASKS_TODAY, LEAVE_CALENDAR, ATTENDANCE_ALERTS, NEW_EMPLOYEES, CONTRACT_EXPIRING, USER_SUMMARY, EMPLOYEE_SUMMARY, MODULE_STATUS, CONFIG_WARNINGS, SYSTEM_LOGS. Dashboard Admin hiện chỉ có 1 widget (NOTIFICATIONS)",
      "RECONCILE DOC TRƯỚC KHI CODE: DB-07 tự mâu thuẫn — §8.5 liệt 12 widget có required_permission_code, nhưng §14.3 xếp vào dashboard Admin 5 widget (USER_SUMMARY, EMPLOYEE_SUMMARY, MODULE_STATUS, CONFIG_WARNINGS, SYSTEM_LOGS) KHÔNG có trong §8.5; chúng chỉ có permission code ở API-10:288-313. Phải sửa DB-07 §8.5 cho đủ rồi mới seed, nếu không catalog sẽ có widget thiếu required_permission_code (cột NOT NULL)",
      "Chỉ seed widget khi module nguồn đã có data source (DASH-BE-2 đăng ký service theo data_source_key), nếu không widget sẽ luôn degraded. Mỗi widget mới phải có entry trong DASH_WIDGET_GATE_PAIR với comment trỏ migration:dòng + lý do ngữ nghĩa — test E3 chỉ chứng cặp TỒN TẠI, không bắt được cặp có-thật-sai-ngữ-nghĩa",
      "Cặp refresh:dashboard-cache (DASH.CACHE.REFRESH): API-10:313 cấp cho SA DUY NHẤT và 'không có endpoint'. Chỉ seed khi (a) DB-07 §10.2 được cập nhật để liệt nó, VÀ (b) có endpoint thật + role để grant. Trước đó nó là quyền phantom không deny-path",
      "Cập nhật khối DRIFT trong DB-07 §14.3 (gỡ khi đã bù đủ). Int-spec: catalog == tập mới; default config == DB-07 §14.3 đầy đủ; grant-matrix vét cạn 4 role vẫn xanh; FULL gate security-reviewer + database-reviewer PASS",
    ],
  },
  {
    id: "S4-DASH-BE-1",
    module: "DASH",
    layer: "BE",
    title:
      "BE Dashboard resolver (GET /dashboard/me, /types, /:type) + widget registry + permission/scope gate — crown data-scope",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/dashboard/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
      "docs/plans/S4-DASH-BE-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-DASH-SEED-1"],
    src: [
      "ISSUE-BOARD-01 §18 (DASH-BE-001)",
      "API-08",
      "IMP02-STORY-085",
      "IMPLEMENTATION-07 §11.1/§11.4",
      "SPEC-07",
    ],
    plan: "docs/plans/S4-DASH-BE-1.md",
    done_when: [
      "GET /api/v1/dashboard/me (resolve dashboard mặc định theo permission user) · GET /dashboard/types (type được xem) · GET /dashboard/:type — trả widget allowed theo permission + user context; KHÔNG hard-code dashboard theo role (dựa dashboard_widget_configs)",
      "Widget registry service: chỉ trả widget mà user có required_permission; widget nhạy cảm kiểm CẢ permission DASH lẫn permission module nguồn; mọi query filter company_id",
      "DTO contracts dual-build; envelope API-01; widget list có limit",
      "Int-spec RED-trước: employee KHÔNG thấy widget Manager/HR · cross-tenant deny · dashboard/me trả đúng type theo quyền; FULL gate security-reviewer + plan-reviewer PASS trước code (crown)",
    ],
    // PHIÊN 2026-07-10 (lane dashbe1) — CODE XONG (WIP 3c769f7, nhánh auto/S4-DASH-BE-1): 15/18 int-spec
    // xanh gồm đủ thuộc tính crown (M10 gate tầng-2 hai chiều, M6 cross-tenant, deny-403, 404, limit).
    // 3 spec đỏ KHÔNG phải lỗi code: role manager/hr THIẾU grant read:dashboard (gate /me + /types) —
    // seed-drift: 0100 blanket CROSS JOIN chạy TRƯỚC khi manager/hr sinh ra ở 0444. Owner chốt 2026-07-11:
    // backfill bằng WO S4-DASH-SEED-2 (dưới) rồi rerun 3 spec → chốt PR lane này. KHÔNG đổi gate design
    // (phương án OR view-* bị bác — làm DASH-ERR-DASHBOARD_NOT_RESOLVED 404 không bắn được qua HTTP).
  },
  {
    id: "S4-DASH-SEED-2",
    module: "DASH",
    layer: "DB",
    title:
      "Backfill grant read:dashboard cho role manager + hr (role sinh ở 0444 lỡ blanket 0100) — mở khóa GET /dashboard/me|/types cho 2/4 persona, blocker của S4-DASH-BE-1",
    zone: "red",
    status: "todo",
    paths: ["apps/api/migrations/**", "apps/api/test/integration/**"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "Phát hiện bởi lane S4-DASH-BE-1 (2026-07-10): 3 int-spec đỏ — /dashboard/me|/types 403 cho manager/hr; xác minh psql: read:dashboard chỉ có ở 10 role cũ (mig 0005), manager/hr vắng",
      "apps/api/migrations/0100_g14_dashboard_permissions_seed.sql (blanket CROSS JOIN gốc)",
      "apps/api/migrations/0444_* (S2-AUTH-SEED-1 — nơi sinh role manager/hr)",
      "apps/api/test/integration/task-recon-grants.int-spec.ts (mẫu int-spec assert grant per-pair)",
    ],
    done_when: [
      "OWNER CHỐT 2026-07-11 (phương án 1, bác phương án đổi gate): migration đánh số nối tiếp head thật (đọc _journal.json — sau 0487 → mint 0488, when +5000): INSERT idempotent role_permissions effect='ALLOW' cho role GLOBAL manager + hr × permission (action='read', resource_type='dashboard') — resolve role_id/permission_id trong DO-block per-pair (mirror 0444/0480/0486, KHÔNG blanket CROSS JOIN mới), ON CONFLICT DO NOTHING, KHÔNG DDL. data_scope: SELECT giá trị 0100 đã set cho role cũ (employee/company-admin) rồi mirror ĐÚNG — KHÔNG bịa (bài học §13 per-pair scope)",
      "Rà 3 blanket còn lại tiền-0444 (0063/0101/0132): liệt kê cặp manager/hr cũng lỡ vào COMMENT migration — CHỈ backfill read:dashboard ở WO này, cặp khác thuộc domain park (report/approval legacy) KHÔNG grant khi chưa có yêu cầu nghiệp vụ (fail-closed)",
      "Int-spec RED-trước kiểu task-recon-grants (gate hasDb && LANE_DB): (a) manager + hr có grant (read,dashboard) sau migration · (b) chạy lại idempotent — grant-count không đổi · (c) snapshot role_permissions trước/sau: đúng +2 row, KHÔNG role/permission nào khác bị đụng · (d) PermissionService.can('read','dashboard') = allow cho user gắn role manager/hr",
      "Ghi chú quy trình vào comment migration: role mới tạo sau này PHẢI backfill blanket-grant tiền nhiệm (bài học 0100↔0444); FULL gate security-reviewer + database-reviewer PASS",
    ],
  },
  {
    id: "S4-DASH-BE-2",
    module: "DASH",
    layer: "BE",
    title:
      "BE Widget data services (GET /dashboard/widgets, /widgets/:slug) cho 7 widget In-sprint + cache TTL + degraded state — data-scope + module nguồn permission",
    zone: "red",
    status: "done",
    paths: [
      "apps/api/src/dashboard/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
      "docs/plans/S4-DASH-BE-2.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-DASH-BE-1", "S4-TASK-BE-2", "S4-NOTI-BE-1"],
    src: [
      "ISSUE-BOARD-01 §18 (DASH-BE-002)",
      "API-08",
      "IMP02-STORY-086/087/088/090",
      "IMPLEMENTATION-07 §11.3/§11.4",
    ],
    plan: "docs/plans/S4-DASH-BE-2.md",
    done_when: [
      "GET /dashboard/widgets (catalog khả dụng) · GET /dashboard/widgets/:slug (data 1 widget, hỗ trợ refresh=true) cho 7 widget In-sprint: MY_TASKS/TASK_ALERTS (TASK) · NOTIFICATIONS (NOTI) · ATTENDANCE_TODAY/PENDING_LEAVE (ATT/LEAVE đã build) · PROJECT_PROGRESS (TASK) · HR_OVERVIEW (HR)",
      "Widget data ÁP data-scope + permission TRƯỚC khi aggregate (Own/Team/Department/Company); cache TTL ngắn cho widget nặng, cache_key gồm user/scope khi data theo user — KHÔNG dùng chung cache giữa user nếu data Own/Team nhạy cảm",
      "⚠️ NGHĨA VỤ CHUYỂN TỪ DDL SANG SERVICE (mig 0482 header §29-30 ghi rõ: 'ÉP ở tầng service S4-DASH-BE §9.7 step6, KHÔNG ở DDL'): dashboard_widget_cache CHỈ được ghi dữ liệu ĐÃ MASK + TRONG-SCOPE. DB không có constraint nào chặn việc này ⇒ nếu service ghi thẳng row chưa mask thì rò dữ liệu nhạy cảm qua cache mà không test nào bắt. Int-spec BẮT BUỘC: ghi cache cho user scope Own rồi đọc lại bằng user khác ⇒ KHÔNG thấy field nhạy cảm; và cache_key khác nhau giữa 2 user khác scope.",
      "Module nguồn lỗi → widget trả Degraded/Error, KHÔNG làm sập toàn dashboard; dashboard chỉ trả quick-action metadata (action thật gọi module gốc); last_updated_at khi cache hit",
      "Int-spec RED-trước: widget data đúng scope (employee chỉ thấy task/leave của mình) · cross-tenant deny · degraded khi module nguồn fail (không 500 toàn dashboard) · cache không rò dữ liệu user khác; FULL gate security-reviewer + silent-failure-hunter PASS",
      "SHIPPED (L2-widget-data-cache): DashboardWidgetDataController (widgets · widgets/:slug, controller thứ 3 @Controller('dashboard')) + 7 handler CHỈ gọi method đã-scope của module nguồn (TaskCoreService.getMyTasks · TasksService.listByProject sau ProjectsService.getProject authorize · MyNotificationsService.list · AttendanceReadService.listMyRecords + tz.util localDateOf · LeaveApprovalService.listPending · HrReadService.listHrEmployees) + DashboardWidgetCacheService (cache_key company+type+widget+userId per-user / company-shared khi scope=Company viewer-independent; upsert INSERT/UPDATE no-DELETE; min-refresh 10s; TTL nhóm §9.2) + runner degraded (HttpException 403/404/400 propagate fail-closed, non-Http → Degraded 200). DI-exports additive: notifications+MyNotificationsService · leave+LeaveApprovalService · tasks+TaskCoreService+ProjectsService. Test test/integration/dashboard-widget-data.int-spec.ts 13/13 xanh trên mediaos_dashbe2 (D1 deny · D2 catalog omit · D3 project-progress 400/403/404 · D4 degraded+deny-không-nuốt · D5 cache miss→hit→refresh min-interval → regen · D6 per-user key + app KHÔNG DELETE grant · D7 HR_OVERVIEW no salary/PII). Dashboard suite 102/102 (no regression). Còn nợ lane khác: S4-INT-2 cache-invalidation từ event · S4-FE-DASH-1 render · S4-QA-1.",
    ],
  },
  {
    id: "S4-INT-1",
    module: "INT",
    layer: "BE",
    title:
      "Tích hợp TASK → NOTI: wiring event producer (outbox) → consumer intake, tạo notification đúng recipient cho mọi event TASK/PROJECT — E2E task→noti — crown",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/tasks/**",
      "apps/api/src/notifications/**",
      "apps/api/src/events/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-INT-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-3", "S4-TASK-BE-4", "S4-NOTI-BE-2", "S4-NOTI-SEED-2"],
    src: [
      "ISSUE-BOARD-01 §18 (INT)",
      "IMP02-STORY-102",
      "IMPLEMENTATION-07 §9.4/§15.1",
      "SPEC-06/08",
    ],
    plan: "docs/plans/S4-INT-1.md",
    done_when: [
      "Consumer đọc event TASK/PROJECT từ outbox (TASK_ASSIGNED/ASSIGNEE_CHANGED/STATUS_CHANGED/PRIORITY_CHANGED/DUE_DATE_CHANGED/COMMENT_CREATED/COMMENT_MENTIONED/PROJECT_MEMBER_ADDED/REMOVED/PROJECT_CLOSED) → gọi NOTI intake (S4-NOTI-BE-2) → tạo notification IN_APP đúng recipient theo §9.4; chỉ phát mã có trong registry §9.5",
      "Recipient đúng bảng §9.4 (assignee/watcher/reporter, LOẠI actor); dedupe áp dụng; delivery ghi log; không rò cross-tenant (recipient cùng company)",
      "E2E: Manager tạo+giao task cho Employee A → A thấy unread badge tăng → mở dropdown → mark read → deep link tới task detail (module gốc kiểm quyền lại) — theo §15.1",
      "Int/E2E RED-trước: event → đúng số notification & recipient · actor không tự nhận · mention ngoài scope không tạo · idempotent (không nhân đôi khi retry outbox); FULL gate security-reviewer + silent-failure-hunter + plan-reviewer PASS trước code (crown)",
    ],
  },
  {
    id: "S4-INT-2",
    module: "INT",
    layer: "BE",
    title:
      "Tích hợp DASH cache invalidation từ event TASK/NOTI/ATT/LEAVE (POST /internal/v1/dashboard/cache/invalidate) — chỉ mã do producer thật phát (§11.5 reconcile)",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/src/dashboard/**",
      "apps/api/src/events/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-INT-2.md",
    ],
    skills: ["code-review"],
    depends_on: ["S4-DASH-BE-2", "S4-INT-1"],
    src: ["ISSUE-BOARD-01 §18 (INT)", "IMP02-STORY-103", "IMPLEMENTATION-07 §11.5", "SPEC-07"],
    plan: "docs/plans/S4-INT-2.md",
    done_when: [
      "Internal invalidate cache theo event, map event→widget đúng §11.5 NHƯNG chỉ dùng mã do producer THẬT phát (registry §9.5): TASK_ASSIGNED→MY_TASKS/TASK_ALERTS · TASK_STATUS_CHANGED→MY_TASKS/TASK_ALERTS/PROJECT_PROGRESS · TASK_DUE_DATE_CHANGED/TASK_OVERDUE→TASK_ALERTS · NOTIFICATION_CREATED/READ→NOTIFICATIONS · LEAVE_*/ATTENDANCE_* (nếu module ATT/LEAVE phát — nếu không thì loại/map lại, ghi rõ trong plan)",
      "Internal endpoint chỉ nhận trusted context; invalidate company-scoped; không invalidate cache user khác ngoài phạm vi event",
      "Int-spec: event → đúng widget bị invalidate (cache miss lần đọc kế) · mã không có producer bị loại/map · cross-tenant không ảnh hưởng; check.sh xanh + LIGHT gate",
    ],
  },
  {
    id: "S4-FE-REGISTRY-1",
    module: "TASK",
    layer: "FE",
    title:
      "FE đăng ký module TASK·NOTI·DASH vào route/sidebar/action registry + query layer wiring (PermissionGate, i18n vi) — nền cho màn Sprint 4",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/**",
      "apps/app/src/layouts/**",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
      "docs/plans/S4-FE-REGISTRY-1.md",
    ],
    skills: ["code-review"],
    plan: "docs/plans/S4-FE-REGISTRY-1.md",
    depends_on: [],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-FE/NOTI-FE/DASH-FE)",
      "FRONTEND-03",
      "IMPLEMENTATION-07 §12.1/§13.1/§14.1",
      "UI-06/07/08",
    ],
    done_when: [
      "Route metadata + sidebar group + action registry cho TASK (/tasks, /projects...), NOTI (/notifications...), DASH (/dashboard...) với module code + permission rõ ràng; hiển thị theo PermissionGate/useCan (KHÔNG hard-code)",
      "PERMISSION_CODE_TO_PAIR (web-core) map ĐÚNG cặp (action,resourceType) theo seed TASK/NOTI/DASH — bài học S3-FE pair-drift (map sai → app ẩn với mọi role); verify khớp seed thật",
      "i18n vi đủ key nhãn module/menu; api-client method skeleton cho TASK/NOTI/DASH; FE spec render sidebar theo quyền",
      "check.sh xanh (typecheck + test + build 3 app); LIGHT gate (react-reviewer + quality-gate)",
    ],
  },
  {
    id: "S4-FE-TASK-1",
    module: "TASK",
    layer: "FE",
    title:
      "FE Project screens: ProjectListPage · ProjectDetailPage · ProjectFormDrawer · ProjectMemberTable (P0/P1)",
    zone: "green",
    status: "done", // PR #146 (e58a4eb) 2026-07-11 — routes /tasks/projects[/:projectId]; task-summary = empty-state chờ FE-TASK-2 (không client GET /tasks)
    paths: ["apps/app/src/routes/**", "apps/app/src/i18n/**", "packages/web-core/src/lib/**"],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-1", "S4-FE-REGISTRY-1"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-FE-001)",
      "IMP02-STORY-065/066/067",
      "FRONTEND-04",
      "IMPLEMENTATION-07 §12.2",
      "UI-06",
    ],
    done_when: [
      "ProjectListPage (list + filter + pagination) · ProjectDetailPage (overview + task summary) · ProjectFormDrawer (tạo/sửa, RHF+Zod validation) · ProjectMemberTable (thêm/đổi role/xóa member); nút Create/action ẩn/disable theo permission (PermissionGate/useCan)",
      "Query/mutation hooks TanStack Query + invalidation; loading/error/empty state; deep link /projects/:id; masking do server (client chỉ render field nhận được)",
      "i18n vi đủ key; FE spec render + gating (thiếu quyền → Forbidden/ẩn nút)",
      "check.sh xanh; LIGHT gate (react-reviewer + quality-gate)",
    ],
  },
  {
    // Nợ ghi nhận từ PR #145 (S4-TASK-BE-2): GET /tasks đổi nghĩa (list scoped + gate read:task, DTO taskCore*),
    // my-tasks → GET /tasks/my. tasksApi trong web-core gọi shape cũ nhưng ĐÃ xác minh 0 app import (code chết
    // kiểu notificationApi/PR #140) — dọn để không ai vô tình dùng lại client sai contract.
    id: "S4-FE-TASK-CLEANUP-1",
    module: "TASK",
    layer: "FE",
    title:
      "Gỡ/chuyển tasksApi legacy (web-core tasks-api.ts) — code chết gọi GET /tasks shape cũ sau BREAKING PR #145 (my-tasks → /tasks/my)",
    zone: "green",
    status: "todo",
    paths: ["packages/web-core/src/lib/**", "packages/web-core/src/index.ts"],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "PR #145 (S4-TASK-BE-2 — BREAKING note)",
      "S4-FE-NOTI-CLEANUP-1 (PR #140, quy trình gỡ api chết)",
    ],
    done_when: [
      "Quét lại consumer 3 app (app/console/auth) + packages chứng minh 0 import tasksApi/tasks-api (mirror quy trình PR #140); nếu phát hiện consumer sống → DỪNG, báo người",
      "Gỡ packages/web-core/src/lib/tasks-api.ts + tasks-api.spec.ts + export ở barrel (nếu có); HOẶC nếu S4-FE-TASK-2 đã cần client thì thay bằng taskCoreApi theo GET /tasks/my + DTO taskCore* contracts — KHÔNG giữ shape cũ",
      "pnpm --filter @mediaos/web-core build + test xanh; typecheck 3 app xanh (chứng minh không còn tham chiếu); LIGHT gate",
    ],
  },
  {
    id: "S4-FE-TASK-2",
    module: "TASK",
    layer: "FE",
    title:
      "FE Task screens: TaskListPage · MyTasksPage · TaskDetailPage · TaskFormDrawer · TaskAssignControl · TaskStatusSelect (P0)",
    zone: "green",
    status: "todo",
    paths: ["apps/app/src/routes/**", "apps/app/src/i18n/**", "packages/web-core/src/lib/**"],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-3", "S4-FE-REGISTRY-1"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-FE-002)",
      "IMP02-STORY-068/069/070/071",
      "FRONTEND-04",
      "IMPLEMENTATION-07 §12.2",
      "UI-06",
    ],
    done_when: [
      "TaskListPage (filter status/priority/assignee/project/due/overdue) · MyTasksPage (assigned/created/watched) · TaskDetailPage · TaskFormDrawer · TaskAssignControl (assignee/watcher) · TaskStatusSelect (status/priority/deadline) — action theo permission",
      "Optimistic update cho status/checklist CÓ rollback khi API lỗi; direct URL trái quyền → Forbidden/NotFound theo policy; mention/assign autocomplete chỉ hiện người trong scope",
      "i18n vi + FE spec (gating + optimistic rollback); loading/error/empty",
      "check.sh xanh; LIGHT gate",
    ],
  },
  {
    id: "S4-FE-TASK-3",
    module: "TASK",
    layer: "FE",
    title:
      "FE Task collaboration: TaskKanbanPage (drag-drop) · TaskCommentThread (mention) · TaskChecklistPanel · TaskActivityTimeline (P1)",
    zone: "green",
    status: "todo",
    paths: ["apps/app/src/routes/**", "apps/app/src/i18n/**", "packages/web-core/src/lib/**"],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-4", "S4-FE-TASK-2"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-FE-003/004)",
      "IMP02-STORY-072/073/074",
      "FRONTEND-04",
      "IMPLEMENTATION-07 §12.2",
      "UI-06",
    ],
    done_when: [
      "TaskKanbanPage kéo-thả đổi status (chỉ bật khi có quyền update status, optimistic + rollback) · TaskCommentThread (comment CRUD + mention autocomplete trong scope) · TaskChecklistPanel (tick + progress) · TaskActivityTimeline",
      "Confirm khi xóa comment; deep link ?comment_id highlight đúng comment; masking do server",
      "i18n vi + FE spec; loading/error/empty",
      "check.sh xanh; LIGHT gate",
    ],
  },
  {
    id: "S4-FE-NOTI-1",
    module: "NOTI",
    layer: "FE",
    title:
      "FE Notification: NotificationBadge · NotificationDropdown · NotificationListPage · NotificationDetailPage · MarkRead/MarkAllRead · deep link an toàn (P0/P1)",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/**",
      "apps/app/src/components/**",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-BE-1", "S4-FE-REGISTRY-1"],
    src: [
      "ISSUE-BOARD-01 §18 (NOTI-FE-001/002/003)",
      "IMP02-STORY-079/081/082",
      "FRONTEND-04",
      "IMPLEMENTATION-07 §13.2",
      "UI-07",
    ],
    done_when: [
      "NotificationBadge (unread count endpoint nhẹ, refresh theo mutation/poll ngắn) · NotificationDropdown (latest, không load cả list) · NotificationListPage · NotificationDetailPage · MarkReadButton/MarkAllReadButton · NotificationTargetLink (deep link KHÔNG bỏ route guard)",
      "Click notification → mark read → navigate target (module gốc kiểm quyền lại); mark-all-read invalidate unread + dropdown + DASH notification widget; deleted/hidden không hiện list mặc định",
      "Empty ('Bạn chưa có thông báo mới') + error state KHÔNG vỡ topbar (badge fallback); i18n vi; FE spec",
      "check.sh xanh; LIGHT gate",
    ],
  },
  {
    id: "S4-FE-NOTI-CLEANUP-1",
    module: "NOTI",
    layer: "FE",
    title:
      "Gỡ dứt điểm NotificationBell (@mediaos/ui) + notification-api legacy (web-core) — code chết gọi route BE đã xoá ở PR #133",
    zone: "yellow",
    status: "todo",
    paths: ["packages/ui/src/components/**", "packages/web-core/src/lib/**", "apps/console/src/**"],
    skills: ["code-review"],
    depends_on: ["S4-FE-NOTI-1"],
    src: [
      "PR #133 (64d4787) gỡ PATCH /notifications/:id/read + /notifications/read-all khỏi NotificationsController",
      "PR #134 (67b12b4) gỡ <NotificationBell/> khỏi apps/console (home.tsx + root-layout.tsx)",
      "packages/ui/src/components/notification-bell.tsx (tự đánh dấu LEGACY/BROKEN)",
      "packages/web-core/src/lib/notification-api.ts",
    ],
    done_when: [
      "BỐI CẢNH: PR #133 gỡ 2 route legacy PATCH /notifications/:id/read + /notifications/read-all (thay bằng POST /:id/mark-read + /mark-all-read ở MyNotificationsController) mà KHÔNG khai trong PR body. Consumer sống lúc đó: packages/ui NotificationBell → web-core notificationApi → apps/console. PR #134 chữa cháy bằng cách gỡ chuông khỏi console. OWNER CHỐT 2026-07-10: chấp nhận console không có chuông (SPEC-08/FRONTEND-12 chỉ định NOTI cho apps/app)",
      "Gỡ packages/ui/src/components/notification-bell.tsx + packages/web-core/src/lib/notification-api.ts (và export trong barrel) — chúng đang ship nhưng gọi route không còn tồn tại; app nào mount sẽ 404. Xác nhận bằng grep là KHÔNG còn consumer nào trước khi xoá",
      "Dọn comment tạm S4-FE-NOTI-CONSOLE-BELL-1 trong apps/console/src/routes/home.tsx + root-layout.tsx; slot `notifications` của AppShell để trống hợp lệ (không để lại TODO mồ côi)",
      "packages/ui + packages/web-core dual-build xanh; apps/console + apps/app build + test xanh; check.sh (TURBO_FORCE=1) xanh; LIGHT gate",
    ],
  },
  {
    id: "S4-FE-DASH-1",
    module: "DASH",
    layer: "FE",
    title:
      "FE Dashboard shell + P0 widgets: DashboardMePage · DashboardWidgetGrid · WidgetCard · MyTasksWidget · TaskAlertsWidget · NotificationsWidget (P0)",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/**",
      "apps/app/src/components/**",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-DASH-BE-2", "S4-FE-REGISTRY-1"],
    src: [
      "ISSUE-BOARD-01 §18 (DASH-FE-001/002)",
      "IMP02-STORY-085/086/090",
      "FRONTEND-04",
      "IMPLEMENTATION-07 §14.2",
      "UI-08",
    ],
    done_when: [
      "DashboardMePage (load shell trước, widget lazy) · DashboardWidgetGrid (responsive) · WidgetCard (shell dùng chung) · MyTasksWidget · TaskAlertsWidget · NotificationsWidget — dựa dashboard/me + widget endpoint, KHÔNG hard-code theo role",
      "Widget thiếu quyền bị ẩn/Hidden theo backend; widget lỗi module nguồn → Degraded/ErrorState (không sập dashboard); quick action chỉ điều hướng module gốc; refresh từng widget",
      "i18n vi; FE spec (gating + degraded render); last_updated_at khi cache hit",
      "check.sh xanh; LIGHT gate",
    ],
  },
  {
    id: "S4-FE-DASH-2",
    module: "DASH",
    layer: "FE",
    title:
      "FE Dashboard widget mở rộng: AttendanceTodayWidget · PendingLeaveWidget · ProjectProgressWidget · HrOverviewWidget + DashboardTypeSwitcher (P1)",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/**",
      "apps/app/src/components/**",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-DASH-BE-2", "S4-FE-DASH-1"],
    src: [
      "ISSUE-BOARD-01 §18 (DASH-FE-002/003)",
      "IMP02-STORY-086/087/088",
      "FRONTEND-04",
      "IMPLEMENTATION-07 §14.2",
      "UI-08",
    ],
    done_when: [
      "AttendanceTodayWidget · PendingLeaveWidget · ProjectProgressWidget · HrOverviewWidget · DashboardTypeSwitcher (Employee/Manager/HR/Admin nếu có quyền) — bám tập In-sprint §11.3, ẩn theo quyền",
      "Degraded/Error khi module nguồn lỗi; compact view mobile nếu kịp; masking do server",
      "i18n vi; FE spec (type switch theo quyền)",
      "check.sh xanh; LIGHT gate",
    ],
  },
  {
    id: "S4-QA-1",
    module: "TASK",
    layer: "QA",
    title:
      "QA Sprint 4 permission/data-scope + deny-path: TASK CRUD/assign/status · NOTI own-scope/mark-read · DASH widget visibility theo quyền (coverage ≥80%)",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/test/integration/**", "apps/app/src/**", "docs/plans/S4-QA-1.md"],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-4", "S4-NOTI-BE-2", "S4-DASH-BE-2"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-QA-001/002, NOTI-QA-001)",
      "IMP02-STORY-106",
      "IMPLEMENTATION-07 §17",
      "SPEC-06/07/08",
    ],
    plan: "docs/plans/S4-QA-1.md",
    // PLAN-BLOCK 2026-07-12 (run wf_f0acd8b7): plan-reviewer chặn với phát hiện THẬT — các ràng buộc
    // dưới đây bake vào done_when để lần chạy lại không lặp. TIỀN ĐỀ: chỉ chạy lại SAU khi PR #177
    // (FE widgets P1) + #178 (invalidation endpoint) đã merge vào master.
    done_when: [
      "SCOPE: S4-QA-TASK-1/S4-QA-NOTI-1 ĐÃ SHIP (PR #165/#167 merged) — XÁC MINH spec của 2 WO đó tồn tại + chạy xanh trên base branch TRƯỚC khi tuyên bố 'không viết trùng'; phần TASK/NOTI chỉ bù lỗ hổng, trọng tâm = DASH + 2-tenant cross-module",
      "Deny-path RED cho permission/workflow: TASK (tạo/gán/đổi status trái quyền + transition sai) · NOTI (đọc/mark notification người khác) · DASH (widget Manager/HR với employee) — chạy trên DB cô lập theo lane; vì code ĐÃ đúng nên mỗi deny-path PHẢI chứng minh test có-thể-đỏ: assert đúng 403 + error body (KHÔNG chỉ !=200) và mutation-check (tạm gỡ guard → test lật RED, ghi bằng chứng vào plan) — chống vacuous-green (bài học reviewers-pass-real-bugs)",
      "FE smoke CHỈ assert widget CÓ component thật render qua PermissionGate (sau #177: MY_TASKS/TASK_ALERTS/NOTIFICATIONS + ATTENDANCE_TODAY/PENDING_LEAVE/PROJECT_PROGRESS/HR_OVERVIEW); LEAVE_CALENDAR/ATTENDANCE_ALERTS CHƯA có component → KHÔNG assert render/không-render ở FE; 'employee không thấy widget Manager/HR' chứng ở TẦNG SERVER (GET /dashboard/me|/widgets omit theo quyền), không phải FE render",
      "Assert dương finance_report theo ĐÚNG tập role seed 0101 (cfo/finance/leadership/admin — KHÔNG bó hẹp 'chỉ finance/admin'); biên deny = employee/hr/manager",
      "Data-scope 2-tenant regression: task/notification/widget không rò cross-tenant; project member scope đúng",
      "Coverage ≥80% vùng Sprint 4 (nhạy cảm cao hơn); test colocated src/**/*.spec.ts (bài học vitest-unit-specs-must-be-colocated — spec để test/ KHÔNG chạy)",
      "check.sh xanh; báo cáo coverage; FULL gate cho phần permission/workflow",
    ],
  },
  {
    id: "S4-QA-2",
    module: "INT",
    layer: "QA",
    title:
      "QA Sprint 4 E2E + regression sign-off: flow task→noti→dash (§15.1) + notification deep link + dashboard degraded + regression S0–S3",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/test/**", "apps/app/src/**", "docs/plans/S4-QA-2.md"],
    skills: ["code-review"],
    depends_on: ["S4-INT-2", "S4-FE-DASH-2", "S4-QA-1"],
    src: [
      "ISSUE-BOARD-01 §18 (DASH-QA-001)",
      "IMP02-STORY-108",
      "IMPLEMENTATION-07 §15/§18",
      "IMPLEMENTATION-08 (đầu vào S5)",
    ],
    plan: "docs/plans/S4-QA-2.md",
    done_when: [
      "E2E P0: giao task → nhận notification → mark read → deep link task detail (§15.1); dashboard widget hiển thị task/notification mới sau event; degraded state khi module nguồn lỗi",
      "Regression S0–S3 vẫn xanh (AUTH/HR/ATT/LEAVE không vỡ); danh sách known-issues critical/high đã xử lý hoặc ghi rõ",
      "OpenAPI/contracts cập nhật cho TASK/NOTI/DASH; release note Sprint 4",
      "check.sh xanh toàn workspace; sign-off Sprint 4 → đầu vào Sprint 5 (IMPLEMENTATION-08)",
    ],
  },

  // ════════════════════ SPRINT 5 — Integration · QA Hardening · UAT (EPIC-10/11) ════════════════════
  // IMPLEMENTATION-08 · WS A-H. Integration-first: ghép FE+BE+DB+seed+env, đóng băng contract, siết
  // permission/data-scope, regression + smoke + E2E + security + perf, UAT + release readiness.
  // Phần lớn integration story (098/099/100/102/103) ĐÃ xong qua INT WO per-sprint (S2-INT-1/2·S3-INT-1·
  // S4-INT-1/2) — S5 là FREEZE + HARDEN + verify toàn hệ, KHÔNG build feature mới. Đa số phụ thuộc S4 hội tụ.
  {
    id: "S5-DEVOPS-1",
    module: "DEVOPS",
    layer: "DEVOPS",
    title:
      "Staging/UAT readiness: env + deploy pipeline + migration/seed chạy từ DB trống + test account đủ role (Employee/Manager/HR/Admin/Super Admin) — đối chiếu topology PROD/DEV-ONLINE đang chạy",
    zone: "yellow",
    status: "todo",
    paths: [
      ".github/workflows/**",
      "docker-compose.yml",
      ".env.example",
      "scripts/**",
      "mediaos.ps1",
      "docs/plans/S5-DEVOPS-1.md",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "ISSUE-BOARD-01 §18 (DEVOPS-ENV-002)",
      "IMPLEMENTATION-08 §10 (WS-A)",
      "IMPL08-READY-001..005",
      "DEVOPS-03/04",
    ],
    done_when: [
      "Staging/UAT env có URL ổn định (đối chiếu topology PROD + DEV-ONLINE đang chạy: NSSM API + cloudflared tunnel + Pages — ghi rõ cái nào là staging/UAT, không dựng trùng); pipeline deploy BE+FE chạy được",
      "Migration + seed chạy sạch từ DB trống (0000→head) trên env staging; test account đủ 5 role có sẵn (seed hoặc script), không secret thật trong repo",
      "Checklist môi trường IMPLEMENTATION-08 §10.3 đạt; Known Blockers ghi rõ nếu READY-001..008 chưa đủ",
      "check.sh xanh; LIGHT gate",
    ],
  },
  {
    id: "S5-QA-E2E-1",
    module: "INT",
    layer: "QA",
    title:
      "Integration freeze + system smoke P0 + cross-module E2E: login→Home Portal→module workspace→check-in→nghỉ phép→task→notification→dashboard (WS-B/C)",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/test/**", "apps/app/src/**", "docs/plans/S5-QA-E2E-1.md"],
    skills: ["code-review"],
    depends_on: ["S4-QA-2"],
    src: ["IMP02-STORY-108", "IMPLEMENTATION-08 §11/§12", "SPEC-01..08"],
    done_when: [
      "Smoke checklist P0 IMPLEMENTATION-08 §11.2 pass toàn module (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH + Foundation); exit criteria §11.3 đạt",
      "E2E bắt buộc §12.1: đăng nhập → Home → workspace → check-in/out → tạo+duyệt nghỉ phép (sync ATT) → tạo+cập nhật task → nhận+đọc notification (deep link) → dashboard widget cập nhật; mỗi flow qua module gốc (BE kiểm quyền lại)",
      "Bug phát hiện được triage P0/P1/P2 (bảng theo dõi); regression sau fix xanh",
      "check.sh xanh; báo cáo smoke/E2E; FULL gate cho flow chạm auth/permission",
    ],
  },
  {
    id: "S5-BE-CONTRACT-1",
    module: "INT",
    layer: "BE",
    title:
      "API contract & OpenAPI/Swagger chuẩn hoá theo module + FE integration hardening (401/403/422/500 mapping, request-id, idempotency, query invalidation sau mutation) — WS-D",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/src/**",
      "packages/contracts/src/**",
      "packages/web-core/src/lib/**",
      "apps/app/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-QA-2"],
    src: ["IMP02-STORY-095/105", "IMPLEMENTATION-08 §13", "API-01..08"],
    done_when: [
      "OpenAPI/Swagger đủ endpoint AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation (request/response/error/auth/permission note) — đối chiếu Swagger đã dựng ở debt-wave2, hoàn thiện phần thiếu (KHÔNG dựng trùng)",
      "FE api-client chuẩn hoá error mapping 401/403/422/500 + request-id + idempotency key; query invalidation bắt buộc sau mutation IMPLEMENTATION-08 §13.3",
      "Contract Zod (packages/contracts) khớp API thật; envelope API-01 đồng nhất",
      "check.sh xanh; LIGHT gate",
    ],
  },
  {
    id: "S5-SEC-1",
    module: "INT",
    layer: "SEC",
    title:
      "Permission & data-scope hardening + field-level/export permission + security testing (IDOR, file access, sensitive fields, rate-limit auth) — WS-E, crown",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/**", "apps/api/test/**", "docs/_review/**", "docs/plans/S5-SEC-1.md"],
    skills: ["code-review"],
    depends_on: ["S4-QA-2"],
    src: [
      "IMP02-STORY-104/107/109",
      "ISSUE-BOARD-01 §18 (QA-PERM-001, QA-SEC-001)",
      "IMPLEMENTATION-08 §14",
      "docs/permission-matrix-spec.md",
    ],
    plan: "docs/plans/S5-SEC-1.md",
    done_when: [
      "Role/scope test matrix IMPLEMENTATION-08 §14.2 chạy đủ: Own/Team/Department/Company/System × mọi module; negative test §14.4 (truy cập ngoài scope → 403/404, không lộ tồn tại)",
      "Field-level + export permission: dữ liệu nhạy cảm (lương/PII) KHÔNG lộ qua API/list/export/log/notification payload/dashboard cache (masking server-side); kiểm IDOR + file access + rate-limit auth endpoint",
      "Regression permission/data-scope suite tái dùng được (QA-PERM-001); báo cáo security testing (QA-SEC-001) trong docs/_review; 3 bất biến không suy yếu",
      "FULL gate security-reviewer + silent-failure-hunter + rls-tenant-isolation-tester PASS; plan-reviewer PASS trước khi sửa (crown)",
    ],
  },
  {
    id: "S5-QA-REG-1",
    module: "INT",
    layer: "QA",
    title:
      "QA regression suite MVP (test-case matrix theo module × role) + UI state hardening + responsive/accessibility smoke — WS-F",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/test/**", "apps/app/src/**", "docs/QA/**", "docs/plans/S5-QA-REG-1.md"],
    skills: ["code-review"],
    depends_on: ["S4-QA-2"],
    src: ["IMP02-STORY-106/107", "IMPLEMENTATION-08 §15", "SPEC-01..08 (test case)"],
    done_when: [
      "Regression suite MVP §15.2 phủ P0/P1 mọi module (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation) theo role; coverage vùng nhạy cảm ≥80%",
      "UI state checklist §15.3 (loading/empty/error/forbidden/optimistic-rollback) + responsive/a11y smoke §15.4 cho P0 flow",
      "Test colocated src/**/*.spec.ts (bài học vitest-unit-specs-must-be-colocated); flaky test khoanh vùng/ổn định",
      "check.sh xanh; báo cáo regression; LIGHT gate",
    ],
  },
  {
    id: "S5-QA-DASHNOTI-1",
    module: "DASH",
    layer: "QA",
    title:
      "Dashboard & Notification hardening: widget degraded/cache đúng, unread count chính xác, deep link an toàn, invalidation theo event — WS-G",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/src/dashboard/**",
      "apps/api/src/notifications/**",
      "apps/api/test/**",
      "apps/app/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-QA-2", "S4-INT-2"],
    src: ["IMP02-STORY-090/103", "IMPLEMENTATION-08 §16", "SPEC-07/08"],
    done_when: [
      "Dashboard checklist §16.2: widget theo quyền/scope, degraded khi module nguồn lỗi (không sập), cache TTL + không rò cross-user, last_updated_at, quick-action về module gốc",
      "Notification checklist §16.3: unread count chính xác sau mark-read/all-read, dropdown latest, deep link qua route guard, deleted/hidden ẩn đúng, dedupe",
      "Invalidation theo event đúng §11.5 (chỉ mã producer thật phát); regression 2-tenant",
      "check.sh xanh; LIGHT gate",
    ],
  },
  {
    id: "S5-PERF-1",
    module: "DEVOPS",
    layer: "QA",
    title:
      "Performance/reliability smoke + observability baseline: SLA danh sách nhân viên·bảng công·task·notification·dashboard + logging/monitoring/alerting — WS-H",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/src/**", "scripts/**", ".github/workflows/**", "docs/DEVOPS/**"],
    skills: ["code-review"],
    depends_on: ["S4-QA-2"],
    src: [
      "IMP02-STORY-110",
      "ISSUE-BOARD-01 §18 (QA-PERF-001, DEVOPS-MON-001)",
      "IMPLEMENTATION-08 §17",
    ],
    done_when: [
      "Perf smoke/baseline: employee list · attendance record · task list · notification unread · dashboard widget đạt SLA MVP (pagination có limit, không N+1, unread dùng partial index); ghi số đo",
      "Observability baseline: request-id truy vết, log có cấu trúc, monitoring + alerting cơ bản (health/error-rate); đối chiếu hạ tầng PROD đang chạy",
      "Không load test sâu (chuyển release phase nếu cần) — chỉ smoke/baseline",
      "check.sh xanh; báo cáo perf; LIGHT gate",
    ],
  },
  {
    id: "S5-UAT-1",
    module: "PROJECT",
    layer: "QA",
    title:
      "UAT prep + run (script theo role · test data · sign-off) + release readiness checklist + known issues/release notes nội bộ — gate vào Sprint 6",
    zone: "yellow",
    status: "todo",
    paths: ["docs/QA/**", "docs/RELEASE/**", "docs/plans/S5-UAT-1.md"],
    skills: [],
    depends_on: ["S5-QA-E2E-1", "S5-QA-REG-1", "S5-SEC-1"],
    src: ["IMP02-STORY-111/112", "IMPLEMENTATION-08 §5.1 (UAT/Release readiness)"],
    done_when: [
      "UAT script theo role (Employee/Manager/HR/Admin), test data + user chuẩn bị; chạy UAT, ghi nhận feedback + bug triage",
      "Release readiness checklist (migration/seed/env/monitoring/backup/rollback/known-issues) chốt; sign-off draft từng module",
      "Known issues + release notes nội bộ cập nhật; quyết định sẵn sàng chuyển Sprint 6/RC",
      "check.sh xanh; đầu ra là đầu vào IMP09-IN-003/004 (Sprint 6)",
    ],
  },

  // ════════════════════ SPRINT 6 — Stabilization · Release Candidate · Go-live (EPIC-11) ════════════════════
  // IMPLEMENTATION-09 · WS1-WS10. KHÔNG mở rộng scope MVP. Freeze → stabilize → final QA/UAT → security/perf/DB
  // readiness → RC build → go-live runbook + rollback → monitoring/support → final sign-off + handoff.
  {
    id: "S6-GOV-1",
    module: "PROJECT",
    layer: "DOC",
    title:
      "Scope Freeze & Release Governance: đóng băng scope MVP, quy tắc thay đổi sau freeze, RC governance (WS1)",
    zone: "yellow",
    status: "todo",
    paths: ["docs/RELEASE/**", "docs/plans/S6-GOV-1.md"],
    skills: [],
    depends_on: ["S5-UAT-1"],
    src: ["IMPLEMENTATION-09 §10 (WS1)", "IMP09-IN-001/005"],
    done_when: [
      "Scope MVP freeze văn bản hoá (danh sách flow P0/P1 chốt); quy tắc change-control sau freeze §10.3 (chỉ nhận blocker release, có owner duyệt)",
      "Deliverable §10.4: release governance + version/tag policy",
      "Điều kiện đầu vào Sprint 6 (IMP09-IN-001..017) rà soát, ghi trạng thái + blocker",
    ],
  },
  {
    id: "S6-STAB-1",
    module: "PROJECT",
    layer: "BE",
    title:
      "Stabilization & Bug Triage: module stabilization checklist (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation) + fix P0/P1 + daily triage (WS2)",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/src/**", "apps/app/src/**", "docs/RELEASE/**", "docs/plans/S6-STAB-1.md"],
    skills: ["code-review"],
    depends_on: ["S5-UAT-1"],
    src: ["IMPLEMENTATION-09 §11 (WS2)", "IMP09-IN-004"],
    done_when: [
      "Module stabilization checklist §11.5 chạy đủ 8 nhóm; bug P0/P1 fix + retest + regression; severity matrix + triage cadence §11.2/§11.3 áp dụng",
      "Bug lifecycle §11.4 theo dõi; không mở scope mới (chỉ blocker release)",
      "check.sh xanh sau mỗi fix; gate theo zone của vùng chạm (FULL nếu chạm auth/permission/migration)",
    ],
  },
  {
    id: "S6-QA-FINAL-1",
    module: "INT",
    layer: "QA",
    title:
      "QA final pass: regression + E2E + API contract + regression-theo-role + UAT final + điều kiện sign-off (WS3)",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/test/**",
      "apps/app/src/**",
      "docs/QA/**",
      "docs/RELEASE/**",
      "docs/plans/S6-QA-FINAL-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S6-STAB-1"],
    src: ["IMP02-STORY-108/111", "IMPLEMENTATION-09 §12 (WS3)"],
    done_when: [
      "Bộ flow regression P0 §12.2 + regression theo role §12.3 + API regression §12.4 xanh; E2E P0 full pass",
      "UAT final pass §12.5; điều kiện UAT sign-off §12.6 đạt (sign-off từng module + business acceptance)",
      "Known issues còn lại phân loại rõ (fix/defer/waiver); check.sh xanh toàn workspace",
    ],
  },
  {
    id: "S6-SEC-1",
    module: "INT",
    layer: "SEC",
    title:
      "Security / RBAC / Data-Protection final hardening: auth/session · RBAC · field masking · file access · audit · secret/config review (WS4) — crown",
    zone: "red",
    status: "todo",
    paths: ["apps/api/src/**", "apps/api/test/**", "docs/_review/**", "docs/plans/S6-SEC-1.md"],
    skills: ["code-review"],
    depends_on: ["S6-STAB-1"],
    src: ["IMP02-STORY-104/109", "IMPLEMENTATION-09 §13 (WS4)", "docs/permission-matrix-spec.md"],
    plan: "docs/plans/S6-SEC-1.md",
    done_when: [
      "Security checklist §13.2 đủ nhóm: Authentication/session · Authorization/RBAC · Sensitive data (masking) · API security (IDOR/rate-limit) · Secret/config — không lỗi CRITICAL/HIGH mở",
      "Audit log đầy đủ hành động quan trọng; append-only không phá; 3 bất biến (company_id/RLS · no-hard-delete · no-secret-plaintext) verify lại toàn hệ",
      "FULL gate security-reviewer + silent-failure-hunter + rls-tenant-isolation-tester PASS; plan-reviewer PASS trước sửa (crown)",
    ],
  },
  {
    id: "S6-PERF-DB-1",
    module: "DEVOPS",
    layer: "DB",
    title:
      "Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback verification (index, query perf, backup/restore rehearsal) — WS5/WS6",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/**",
      "apps/api/migrations/**",
      "scripts/**",
      "docs/DEVOPS/**",
      "docs/plans/S6-PERF-DB-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S6-STAB-1"],
    src: [
      "IMPLEMENTATION-09 §7.1 (Performance/Database readiness)",
      "IMP09-IN-006/008/012",
      "DB-01..10",
    ],
    plan: "docs/plans/S6-PERF-DB-1.md",
    done_when: [
      "Perf/query/cache hardening: API latency, dashboard cache, notification unread, list pagination, export behavior đạt ngưỡng; index đủ cho query nặng",
      "DB readiness: migration/seed verify ở staging từ trống; backup + restore rehearsal thành công; rollback path verify; migration journal forward-only/no-gap",
      "Không db:generate drop; migration additive; RLS/append-only intact sau verify",
      "check.sh xanh; FULL gate database-reviewer (chạm migration/DB)",
    ],
  },
  {
    id: "S6-REL-1",
    module: "DEVOPS",
    layer: "DEVOPS",
    title:
      "Release Candidate build + release notes + Go-live runbook + deployment/rollback rehearsal + monitoring/alerting/support readiness (WS7/WS8/WS9) — crown release",
    zone: "red",
    status: "todo",
    paths: [
      ".github/workflows/**",
      "scripts/**",
      "docs/RELEASE/**",
      "mediaos.ps1",
      "docs/plans/S6-REL-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["S6-QA-FINAL-1", "S6-SEC-1", "S6-PERF-DB-1"],
    src: [
      "ISSUE-BOARD-01 §18 (RELEASE-REL-001, RELEASE-GO-001)",
      "IMP02-STORY-112",
      "IMPLEMENTATION-09 §9 (WS7/8/9)",
    ],
    plan: "docs/plans/S6-REL-1.md",
    done_when: [
      "RC build + version/tag + release notes; release candidate checklist (RELEASE-REL-001) đủ mục",
      "Go-live runbook + deployment path + rollback rehearsal thành công (RELEASE-GO-001); smoke sau deploy; war-room + communication plan",
      "Monitoring/logging/alerting production + support readiness; đối chiếu hạ tầng PROD/tunnel/NSSM đang chạy",
      "FULL gate security-reviewer + deploy-gate; KHÔNG push thẳng master; người chốt (crown release)",
    ],
  },
  {
    id: "S6-GOLIVE-1",
    module: "DEVOPS",
    layer: "DOC",
    title:
      "Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/support guide · known issues · post-go-live backlog) — WS10",
    zone: "red",
    status: "todo",
    paths: ["docs/RELEASE/**", "docs/**", "docs/plans/S6-GOLIVE-1.md"],
    skills: [],
    depends_on: ["S6-REL-1"],
    src: ["IMP02-STORY-111/112", "IMPLEMENTATION-09 §9 (WS10)", "IMP09-IN-015/016/017"],
    plan: "docs/plans/S6-GOLIVE-1.md",
    done_when: [
      "Final Go/No-go decision (sign-off tất cả module + release readiness); go-live execution theo runbook + smoke sau deploy + hypercare",
      "Handoff: admin guide + user guide + support guide + known issues + post-go-live backlog (Phase 2 → IMPLEMENTATION-10)",
      "MVP release readiness checklist (STORY-112) hoàn tất; đóng Sprint 6 → MVP go-live",
    ],
  },

  // ════════════════════ SCREEN-COVERAGE GAP CLOSERS (audit độ phủ màn hình 2026-07-08) ════════════════════
  // Audit 4-lane FE vs FRONTEND-06/08/09/10/13 + UI-02 sitemap: AUTH/Account 100% · ATT 19/19 · HR 17/18 ·
  // LEAVE 14/15 · System/Foundation 16/16. 3 GAP MÀN THẬT: LEAVE Overview (thiếu) · HR Employee Files (thiếu,
  // cần BE) · System Settings (placeholder, cần BE). Nav/sidebar (S2-FE-FND-7) + sensitive-gating (S2-AUTH-CAP-1)
  // đã done trên board → KHÔNG seed lại. HR Overview (SCREEN-001) đang alias EmployeeList + DASH có HR widget →
  // bỏ (không gap cứng). BE enabler seed kèm vì FE screen không tồn tại được nếu thiếu.
  {
    id: "S3-FE-LEAVE-7",
    module: "LEAVE",
    layer: "FE",
    title:
      "FE LeaveOverviewPage (/leave) — màn tổng quan nghỉ phép: balance summary + quick actions + recent requests + pending approvals + upcoming leave + warning cards (UI-LEAVE-SCREEN-001, P0)",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/leave/**",
      "apps/app/src/router.tsx",
      "apps/app/src/layouts/**",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
      "docs/plans/S3-FE-LEAVE-7.md",
    ],
    skills: ["code-review"],
    plan: "docs/plans/S3-FE-LEAVE-7.md",
    depends_on: [],
    src: ["FRONTEND-10 §7.2/§14.1 (UI-LEAVE-SCREEN-001)", "UI-02 §8.8", "audit FE 2026-07-08"],
    done_when: [
      "LeaveOverviewPage tại /leave: balance summary grid + quick actions (tạo đơn/xem đơn của tôi) + recent requests + pending approvals (chỉ khi có quyền duyệt, PermissionGate) + upcoming approved leave + warning cards (balance thấp/đơn quá hạn)",
      "Đẩy MyLeaveBalancePage sang route riêng /leave/me/balances (đúng SCREEN-001A); /leave = overview; router.tsx cập nhật",
      "TÁI DÙNG API sẵn có (me/balances · me/requests?per_page=5 · requests?status=Pending · calendar) — KHÔNG BE mới; loading/error/empty; masking do server",
      "i18n vi đủ key + FE spec (render + gating pending-approvals); check.sh xanh; LIGHT gate (react-reviewer + quality-gate)",
    ],
  },
  {
    id: "S2-HR-EMPFILE-1",
    module: "HR",
    layer: "BE",
    title:
      "BE Employee File: upload/list/download/soft-delete file hồ sơ nhân viên qua Foundation FileService + file_links (gate HR.EMPLOYEE.FILE_*, data-scope, scan_status, access log) — enabler cho UI-HR-SCREEN-015",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/employees/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
      "docs/plans/S2-HR-EMPFILE-1.md",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "FRONTEND-08 §5.1/§18.7 (UI-HR-SCREEN-015)",
      "DB-03",
      "SPEC-03 (HR.EMPLOYEE.FILE_VIEW/UPLOAD/DELETE)",
      "audit FE 2026-07-08",
    ],
    plan: "docs/plans/S2-HR-EMPFILE-1.md",
    done_when: [
      "BE: POST /hr/employees/:id/files (upload qua Foundation FileService, file_links entity_type='employee_profile') · GET /:id/files (list) · GET /:id/files/:fileId/download · DELETE /:id/files/:fileId (soft) — @RequirePermission HR.EMPLOYEE.FILE_VIEW/UPLOAD/DELETE đúng cặp seed; withTenant + company_id; assertReadScope/assertWriteScope theo data-scope employee (bài học S2-HR IDOR — FK ≠ company_id chưa đủ)",
      "Seed cặp quyền file employee nếu thiếu (migration nối tiếp head, ON CONFLICT DO NOTHING; grant HR/Admin theo scope; allowlist nếu sensitive); KHÔNG đụng RLS employee_profiles",
      "Download TÔN TRỌNG scan_status (không trả file chưa quét sạch — bài học foundation-system-audit); file_access_logs ghi truy cập (append-only); audit upload/delete (không log nội dung file)",
      "Int-spec RED-trước: deny thiếu quyền 403 · cross-tenant/cross-employee 404 (IDOR) · download file scan pending bị chặn · soft-delete loại khỏi list; FULL gate security-reviewer + database-reviewer PASS",
      "SHIPPED (lane s2hrempfile1-be): migration 0477 (mig lane) seed file-view/upload/delete:employee → hr/company-admin Company; contracts hr/employee-file.ts (linkEmployeeFileSchema{fileId,category?} · listEmployeeFilesQuerySchema · employeeFileDtoSchema); apps/api/src/employees/employee-file.{controller,service,repository,resolver}.ts + wired module (EmployeeFileResolver registered onModuleInit for HR/employee_profile, append). Routes /hr/employees/:id/files (POST link · GET list · GET :fileId metadata · GET :fileId/download 302 · DELETE :fileId 204). scan-guard Clean/NotRequired only (else 409); FileService owns file_link/file soft-delete + FileLinked/FileDeleted audit + Link/Download/Delete access-log. int-spec employee-file.int-spec.ts 12/12 GREEN trên LANE_DB=mediaos_s2hrempfile1; adjacent hr-contract/files 45/45 GREEN.",
    ],
  },
  {
    id: "S2-FE-HR-9",
    module: "HR",
    layer: "FE",
    title:
      "FE Employee Files tab trong EmployeeDetailPage: danh sách + upload (progress) + download + xóa mềm theo quyền (UI-HR-SCREEN-015)",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/hr/employees/**",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-HR-EMPFILE-1"],
    src: ["FRONTEND-08 §11/§18.7 (UI-HR-SCREEN-015)", "audit FE 2026-07-08"],
    done_when: [
      "Tab 'File hồ sơ' trong EmployeeDetailPage (không route riêng): danh sách file + nút Upload (progress) + Download + Xóa (confirm) — gate PermissionGate HR.EMPLOYEE.FILE_VIEW/UPLOAD/DELETE (nút ẩn/disable theo quyền)",
      "Tái dùng component upload/download sẵn có; loading/error/empty; masking do server (client chỉ render metadata nhận được)",
      "web-core api method getEmployeeFiles/uploadEmployeeFile/deleteEmployeeFile + spec; i18n vi đủ key; FE spec gating",
      "check.sh xanh; LIGHT gate (react-reviewer + quality-gate)",
    ],
  },
  {
    id: "S2-FND-SYSSET-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "BE System Settings: GET (+PATCH) /foundation/system-settings + quyền manage:system-settings, mask secret — reconcile SettingService/system_settings sẵn có — enabler cho UI-SYSTEM-SCREEN-004",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/foundation/**",
      "apps/api/src/settings/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
      "docs/plans/S2-FND-SYSSET-1.md",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: [
      "FRONTEND-13 §5.1/§16 (UI-SYSTEM-SCREEN-004, FE13-OQ-003)",
      "DB-08 §8.3 (system_settings GLOBAL)",
      "BACKEND-11 §13.3",
      "audit FE 2026-07-08",
    ],
    plan: "docs/plans/S2-FND-SYSSET-1.md",
    done_when: [
      "BE: GET /foundation/system-settings (đọc system_settings GLOBAL theo category/module, MASK giá trị nhạy cảm server-side) + PATCH /:key (update value, audit SettingUpdated) — reconcile SettingService + bảng system_settings sẵn có (KHÔNG tạo bảng mới); system_settings no-RLS GLOBAL ⇒ chỉ super-admin/system-admin thao tác, kiểm quyền CHẶT",
      "Seed cặp quyền view:system-settings + manage:system-settings (migration nối tiếp head, ON CONFLICT DO NOTHING; grant super-admin; company-admin read theo scope); mặc định READ, UPDATE gated sau manage:system-settings (chốt FE13-OQ-003 read-first)",
      "KHÔNG lộ secret hệ thống (env/secret-manager backed) qua DTO — chỉ config non-secret (BẤT BIẾN #3); audit mọi thay đổi",
      "Int-spec RED-trước: non-admin 403 · secret không lộ trong response · update audit đúng · cross không rò; FULL gate security-reviewer PASS (crown — permission + settings)",
    ],
  },
  {
    id: "S2-FE-FND-8",
    module: "FOUNDATION",
    layer: "FE",
    title:
      "FE hoàn thiện SystemSettingsPage (/system/settings) thay placeholder: nhóm setting theo category, mask sensitive, edit gate manage:system-settings (UI-SYSTEM-SCREEN-004)",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/system/**",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
    ],
    skills: ["code-review"],
    depends_on: ["S2-FND-SYSSET-1"],
    src: ["FRONTEND-13 §5.1/§16 (UI-SYSTEM-SCREEN-004)", "audit FE 2026-07-08"],
    done_when: [
      "SystemSettingsPage (/system/settings) thay EmptyState placeholder: nhóm setting theo category, hiển thị value (mask sensitive từ server), form edit gate PermissionGate manage:system-settings; loading/error/empty",
      "Sidebar entry + defaultRoute app Hệ thống về /system (nếu S2-FE-FND-7 chưa phủ đủ); web-core api getSystemSettings/updateSystemSetting + spec",
      "i18n vi đủ key + FE spec (render + gating edit)",
      "check.sh xanh; LIGHT gate (react-reviewer + quality-gate)",
    ],
  },

  // ════════════════════ STORY-COVERAGE GAP CLOSERS (audit story-matrix 2026-07-08) ════════════════════
  // /progress hiện 19 story "planned": 15 = trace-drift (đã vá qua STORY_WO_OVERRIDE trong harness/lib/stories.mjs),
  // 4 = GAP THẬT (chưa có WO): 051 ATT export · 075 TASK file · 076 TASK report · 091 DASH config. Seed 4 WO dưới.
  {
    id: "S4-TASK-BE-5",
    module: "TASK",
    layer: "BE",
    title:
      "BE TASK file (project/task) qua FileService + file_links + Project progress report (GET /projects/:id/report) — P1/P2 (IMP02-STORY-075/076)",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/src/tasks/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-2"],
    src: [
      "IMP02-STORY-075/076",
      "ISSUE-BOARD-01 §18 (TASK-API-271/291)",
      "API-06",
      "IMPLEMENTATION-07 §9.2 (P1/P2)",
      "SPEC-06",
    ],
    done_when: [
      "File project/task qua Foundation FileService + file_links (entity_type 'project'/'task' — TÁI DÙNG pattern S2-HR-EMPFILE-1, KHÔNG bảng task_files riêng nếu file_links đủ): POST /tasks/:id/files · GET list · GET :fileId/download (tôn trọng scan_status) · DELETE soft — @RequirePermission TASK.*.FILE_* theo scope/membership; withTenant + company_id",
      "GET /projects/:id/report: summary tiến độ (đếm task theo status, overdue, assignee workload) — permission + data-scope; limit; envelope API-01",
      "Seed cặp quyền file/report TASK nếu thiếu (migration nối tiếp head, ON CONFLICT DO NOTHING); ghi task_activity_logs TASK_FILE_UPLOADED/DELETED; file_access_logs append-only; audit",
      "Int-spec RED-trước: deny thiếu quyền · cross-tenant/ngoài-membership 404 (IDOR) · download scan pending bị chặn · report đúng scope; check.sh xanh; FULL gate cho nhánh file access (security-reviewer)",
    ],
  },
  {
    id: "S4-FE-TASK-4",
    module: "TASK",
    layer: "FE",
    title:
      "FE TaskFilePanel (upload/list/download/delete theo quyền) + ProjectProgressCard (summary tiến độ) — P1/P2 (IMP02-STORY-075/076)",
    zone: "green",
    status: "todo",
    paths: ["apps/app/src/routes/**", "apps/app/src/i18n/**", "packages/web-core/src/lib/**"],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-5", "S4-FE-TASK-2"],
    src: [
      "IMP02-STORY-075/076",
      "ISSUE-BOARD-01 §18 (TASK-FE-004)",
      "FRONTEND-11",
      "IMPLEMENTATION-07 §12.2",
      "UI-06",
    ],
    done_when: [
      "TaskFilePanel trong TaskDetailPage: danh sách file + upload (progress) + download + xóa (confirm) — PermissionGate TASK.*.FILE_*; ProjectProgressCard trong ProjectDetailPage (task theo status/overdue/workload)",
      "Tái dùng component upload/download; loading/error/empty; masking do server; web-core api getTaskFiles/uploadTaskFile/deleteTaskFile + getProjectReport",
      "i18n vi + FE spec gating",
      "check.sh xanh; LIGHT gate (react-reviewer + quality-gate)",
    ],
  },
  {
    id: "S4-DASH-BE-3",
    module: "DASH",
    layer: "BE",
    title:
      "BE Dashboard widget config CRUD (GET /dashboard/configs, PATCH /configs/:id) theo company/role/user/dashboard-type + audit — P1/P2 (IMP02-STORY-091)",
    zone: "yellow",
    status: "done",
    paths: [
      "apps/api/src/dashboard/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
      "apps/api/migrations/**",
      "apps/api/src/db/schema/audit.ts",
    ],
    skills: ["code-review"],
    depends_on: ["S4-DASH-BE-1"],
    src: [
      "IMP02-STORY-091",
      "ISSUE-BOARD-01 §18 (DASH-API-006/007)",
      "API-08",
      "IMPLEMENTATION-07 §11.2 (P2)",
      "SPEC-07",
    ],
    done_when: [
      "GET /api/v1/dashboard/configs (xem config widget) · PATCH /dashboard/configs/:id (sort_order/is_enabled/layout/data_scope_override/refresh_seconds_override/config theo company/role/user/dashboard-type) — @RequirePermission view/update:dashboard-config (DASH.CONFIG.VIEW/UPDATE, isSensitive, PermissionGuard class-level); withTenant(companyId) RLS+FORCE; cross-tenant/soft-deleted ⇒ 404 DASH-ERR-NOT_FOUND; audit_logs object_type='dashboard_widget_config' action_group='CONFIG_UPDATE' in-tx (append-only)",
      "Config resolve đúng precedence (company→role→user); không cho phép user thấy widget ngoài quyền qua config (read-time tier-2 gate authoritative); DTO contracts dual-build; body rỗng/override sai enum ⇒ 400",
      "Int-spec RED-trước (apps/api/test/integration/dashboard-config-crud.int-spec.ts, 18/18): non-admin 403 · cross-tenant 404 · config không mở widget trái quyền · audit-in-tx · append-only (UPDATE không DELETE) · validation; mig 0491 GRANT UPDATE dashboard_widget_configs + UNION-ADD object_type nối tiếp head THẬT 0490_s4_notiseed2 (idx 171) + sync AUDIT_OBJECT_TYPES; check.sh xanh; FULL gate PASS (security-reviewer + database-reviewer + silent-failure-hunter)",
    ],
  },
  {
    id: "S4-FE-DASH-3",
    module: "DASH",
    layer: "FE",
    title:
      "FE DashboardConfigPage (cấu hình widget theo role/user/dashboard-type: sort/enable/size) — P1/P2 (IMP02-STORY-091)",
    zone: "green",
    status: "todo",
    paths: ["apps/app/src/routes/**", "apps/app/src/i18n/**", "packages/web-core/src/lib/**"],
    skills: ["code-review"],
    depends_on: ["S4-DASH-BE-3", "S4-FE-DASH-1"],
    src: [
      "IMP02-STORY-091",
      "ISSUE-BOARD-01 §18 (DASH-FE)",
      "FRONTEND-07",
      "IMPLEMENTATION-07 §14.2",
      "UI-08",
    ],
    done_when: [
      "DashboardConfigPage: liệt widget theo dashboard-type + toggle enable/sort/size, gate PermissionGate config:dashboard; loading/error/empty",
      "web-core api getDashboardConfigs/updateDashboardConfig + spec; i18n vi; FE spec gating",
      "check.sh xanh; LIGHT gate (react-reviewer + quality-gate)",
    ],
  },
  {
    id: "S3-ATT-EXPORT-1",
    module: "ATT",
    layer: "BE",
    title:
      "ATT export bảng công theo quyền (GET /attendance/records/export CSV, gate export:attendance theo data-scope) + nút Export trên FE reports — P2 (IMP02-STORY-051)",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/src/attendance/**",
      "apps/api/test/integration/**",
      "apps/app/src/routes/attendance/**",
      "packages/web-core/src/lib/**",
      "packages/contracts/src/**",
      "docs/plans/S3-ATT-EXPORT-1.md",
    ],
    skills: ["code-review"],
    plan: "docs/plans/S3-ATT-EXPORT-1.md",
    depends_on: [],
    src: [
      "IMP02-STORY-051",
      "ISSUE-BOARD-01 §18 (ATT export)",
      "FRONTEND-09 §7",
      "API-04",
      "SPEC-04",
    ],
    done_when: [
      "GET /attendance/records/export (CSV/xlsx) — @RequirePermission export:attendance (cặp đã seed att-permissions, HR=Company); áp data-scope Own/Team/Company TRƯỚC khi kết xuất; withTenant + company_id; limit/streaming an toàn; audit export (không lộ dữ liệu ngoài scope/nhạy cảm)",
      "FE: nút Export trên AttendanceReportsPage/records (PermissionGate export:attendance), tải file, loading/error",
      "Int-spec RED-trước: thiếu export:attendance → 403 · export chỉ trả bản ghi trong scope (employee không xuất được team/company) · cross-tenant deny; check.sh xanh; FULL gate (export = lộ dữ liệu — security-reviewer)",
    ],
  },

  // ════════════════════ HR PROFILE UI (nâng cấp màn Hồ sơ nhân sự — owner yêu cầu 2026-07-11) ════════════════════
  {
    id: "HR-PROFILE-UI-1",
    module: "HR",
    layer: "FE",
    title:
      "Nâng cấp màn Hồ sơ nhân sự: dải tổng quan (headcount+donut giới tính+4 thẻ) · 2 chế độ xem bảng⇄chi tiết (split) · tùy chỉnh cột · detail tabs + form anchor-nav — kèm BE mở read-DTO personal-info (PII gate view-sensitive) + GET /hr/employees/summary",
    zone: "red", // chạm masking/PII projection — FULL gate
    status: "todo",
    paths: [
      "packages/contracts/src/hr/**",
      "packages/web-core/src/lib/**",
      "packages/ui/src/**",
      "apps/api/src/employees/**",
      "apps/app/src/routes/hr/**",
      "apps/app/src/i18n/**",
      "apps/app/src/hooks/**",
    ],
    skills: ["code-review"],
    depends_on: [],
    src: ["SPEC-03 §14.18/§15.1/§18.8", "DB-03 §7.2 (mig 0451 self-service cols)", "ADR-0010"],
    done_when: [
      "DTO đọc list/detail thêm avatarUrl+startDate (directory) và gender/dateOfBirth/phone/contractType (list) + personal-info 8 field (detail) — TẤT CẢ PII gate view-sensitive:employee per-row (resourceId, mirror revealSalary); identity_* (CCCD §14.18) TUYỆT ĐỐI không vào read DTO (chờ HR-IDENTITY-READ-1)",
      "GET /hr/employees/summary gate read:employee, aggregate theo scope condition CHUNG với list; byGender chỉ trả khi view-sensitive (type-level) — fail-closed",
      "FE: overview strip ẩn/hiện · toggle bảng⇄chi tiết (split list+panel tabs) · tùy chỉnh cột persist localStorage (cột PII ẩn khỏi catalog khi thiếu quyền) · detail dùng Tabs + section dùng chung · form sửa có anchor-nav; KHÔNG hard-code permission; masking là việc SERVER",
      "Deny-path spec RED-trước (masking field mới + summary scope/gender-gate); typecheck+build+lint+test xanh; FULL gate security-reviewer PASS",
    ],
    // PHIÊN 2026-07-11 (interactive, Claude): code xong toàn bộ done_when trên nhánh feat/hr-profile-ui-v2.
    // hr-read.service.spec 55/55 xanh (8 test mới RED-trước); typecheck/build/lint toàn workspace xanh;
    // 1 int-spec đỏ pre-existing (dead-letter-alert-idempotent — FK cleanup DB chung, không liên quan).
    // Chủ đích ĐỂ LẠI: gom-nhóm cột 1/2 cấp + export (HR-PROFILE-UI-2) · lộ identity_* (HR-IDENTITY-READ-1).
    //
    // PHIÊN 2026-07-11 (1b, owner chốt HYBRID): mở rộng field hồ sơ — mig 0489 = 4 cột typed
    // (tax_code·official_date·probation_end_date·work_location, DB-03 có sẵn) + personal_extra JSONB
    // (nơi sinh/nguyên quán/dân tộc/tôn giáo/quốc tịch — bổ sung DB-03 §7.2 cùng commit; blob = lớp PII,
    // mask NGUYÊN KHỐI, key allowlist Zod .strict, cần lọc → thăng cấp cột). PATCH mở field cá nhân:
    // body chạm PII đòi view-sensitive per-row (fail-closed HR-ERR-PII-WRITE-DENIED); audit CHỈ tên field
    // trong diffSummary — before/after không chứa key PII (FORBIDDEN_AUDIT_KEYS mở rộng). Form edit thêm
    // section Cá nhân/Liên hệ (chỉ render khi có view-sensitive). P1 perf: debounce search 300ms +
    // keepPreviousData + avatar lazy. identity_*/bank_* vẫn ngoài mọi surface.
  },
  {
    id: "HR-PROFILE-UI-2",
    module: "HR",
    layer: "FE",
    title:
      "Hồ sơ nhân sự phần 2: gom nhóm bảng 1/2 cấp (Tùy chỉnh cột) + export danh sách theo quyền export:employee + sort server-side cho cột mới (allowlist HR_EMPLOYEE_SORT_FIELDS)",
    zone: "yellow",
    status: "todo",
    paths: [
      "packages/contracts/src/hr/**",
      "packages/ui/src/**",
      "apps/api/src/employees/**",
      "apps/app/src/routes/hr/employees/**",
    ],
    skills: ["code-review"],
    depends_on: ["HR-PROFILE-UI-1"],
    src: ["SPEC-03", "API-10", "mẫu export theo quyền: S3-ATT-EXPORT-1 (backlog)"],
    done_when: [
      "Gom nhóm 1/2 cấp trong panel Tùy chỉnh cột (group theo đơn vị/trạng thái…) — TanStack grouping, KHÔNG lib bảng mới",
      "GET /hr/employees/export gate export:employee — áp data-scope + masking per-row NHƯ list (export = lộ dữ liệu, FULL gate); cột PII chỉ vào file khi caller có view-sensitive",
      "Mở rộng HR_EMPLOYEE_SORT_FIELDS (allowlist — startDate…) + header sort FE; deny-path: export thiếu quyền 403, export ngoài scope không có row",
    ],
  },
  {
    id: "HR-PERF-1",
    module: "HR",
    layer: "FE",
    title:
      "Tối ưu hiệu năng nền tảng: (a) code-split router theo module (bundle apps/app 1.55MB→lazy route) · (b) batch permission list HR (2 can()/row → canBatch preload company-grants + getObjectGrantsForMany, GIỮ NGUYÊN ngữ nghĩa object-DENY priority-1) · (c) pg_trgm GIN index search nhân sự khi headcount >1–2k — crown ở (b)",
    zone: "red", // (b) chạm permission engine — plan-review TRƯỚC khi code
    status: "todo",
    paths: [
      "apps/app/src/router.tsx",
      "apps/api/src/permission/**",
      "apps/api/src/employees/**",
      "apps/api/migrations/**",
      "docs/plans/HR-PERF-1.md",
    ],
    skills: ["code-review"],
    depends_on: ["HR-PROFILE-UI-1"],
    src: [
      "Phát hiện 2026-07-11 (phiên HR-PROFILE-UI-1): build warning chunk 1.546MB/375KB gzip (apps/app KHÔNG code-split); hr-read list = 2 permission.can()/row (security-reviewer MEDIUM/INFO); search ILIKE '%term%' không ăn index khi dữ liệu lớn",
      "RÀNG BUỘC (b): object_permissions có DENY priority-1 (permission.service.ts ~180) — type-level-ALLOW shortcut là SAI ngữ nghĩa; batch đúng = preload companyGrants 1 lần + object grants của cả trang trong 1 query rồi chạy CÙNG decision-merge; salary audit-on-reveal vẫn per-row",
    ],
    plan: "docs/plans/HR-PERF-1.md",
    done_when: [
      "(a) route-level lazy: mở màn HR không tải bundle TASK/LEAVE/ATT; initial JS giảm đo được (ghi số trước/sau vào PR); không đổi route path/permission gate",
      "(b) PermissionService.canBatch (hoặc tương đương) cho hr-read list: kết quả BẰNG CHÍNH XÁC per-row can() trên bộ test có object-ALLOW lẫn object-DENY; deny-path giữ nguyên; số query permission/trang ≤ 4",
      "(c) migration GIN pg_trgm (users.full_name/email + employee_profiles.employee_code) CHỈ khi owner bật (dữ liệu lớn) — kèm EXPLAIN trước/sau trong PR; FULL gate security-reviewer cho (b)",
    ],
  },
  {
    id: "HR-IDENTITY-READ-1",
    module: "HR",
    layer: "BE",
    title:
      "Lộ identity_number/issue_date/issue_place (CCCD §14.18) qua read surface — OWNER ĐÃ CHỐT 2026-07-12: cặp MỚI view-identity:employee (is_sensitive) + inline detail + audit-on-reveal mirror salary, KHÔNG role-grant sẵn",
    zone: "red",
    status: "todo",
    paths: [
      "packages/contracts/src/hr/**",
      "apps/api/src/employees/**",
      "apps/api/migrations/**",
      "apps/api/test/integration/**",
    ],
    skills: ["code-review"],
    depends_on: ["HR-PROFILE-UI-1"],
    src: [
      "SPEC-03 §14.18 (identity = nhóm giấy tờ nhạy cảm cao)",
      "Mẫu gate+audit: revealSalary (hr-read.service.ts) — reveal ⟹ audit atomically",
      "Tiền lệ seed: 0444 — sensitive pair KHÔNG role-grant (view-salary/update-salary), admin gán per-role/per-object qua UI",
    ],
    done_when: [
      "OWNER CHỐT 2026-07-12 (đã quyết, KHÔNG mở lại): (a) cặp MỚI view-identity:employee is_sensitive=true — KHÔNG tái dùng view-sensitive; (b) migration CHỈ seed pair vào catalog permissions, KHÔNG role-grant (mirror tiền lệ view-salary 0444 — tránh blanket-grant drift); (c) identity_* hiện INLINE trong detail DTO (không endpoint reveal riêng), fail-closed = null khi thiếu quyền",
      "Reveal identity ⟹ audit trong cùng tx (mirror revealSalary hr-read.service.ts — per-row resourceId, isSensitive=true nên wildcard KHÔNG mở); deny-path RED-trước: thiếu quyền → null, wildcard không mở, cross-tenant deny",
      "Nâng gate duyệt change-request cho identity fields: view-sensitive → view-identity (profile-change-request.service.ts — nhất quán với read gate mới)",
      "FE màn Hồ sơ render nhóm CMND/CCCD chỉ khi có capability view-identity (thêm cặp vào SENSITIVE_CAPABILITY_ALLOWLIST /auth/me — bài học HR-PROFILE-UI-1); FULL gate security-reviewer + database-reviewer PASS",
    ],
  },

  // ════════════════════ BUNG THÊM VIỆC LÀM-ĐƯỢC-NGAY (owner chốt 2026-07-11) ════════════════════
  // Nguồn: gap-analysis 3 lát cắt (Sprint4 story · tech-debt/audit · FE screen-coverage) đối chiếu code thật.
  // Tất cả doable-now, ĐỘC LẬP với nút cổ chai S4-DASH-BE-2 (đang in_progress).
  // Nhóm D (INT wiring) owner chốt kiến trúc GENERIC bridge: S4-INT-1 dựng OutboxNotificationBridge chung
  // TRƯỚC → INT-3/4/5 chỉ khai event-type + recipient-resolver ⇒ depends_on S4-INT-1 (chờ tới khi INT-1 done).

  // ─── Nhóm A: NOTI admin FE (green — BE + allowlist đã sẵn 100%, không đụng permission engine) ───
  {
    id: "S4-FE-NOTI-2",
    module: "NOTI",
    layer: "FE",
    title:
      "FE Notification Events admin (UI-NOTI-SCREEN-004): bảng event catalog (search/filter module·status) + toggle bật/tắt event (confirm) — gate view/update:notification-config (đã allowlisted)",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/notifications/**",
      "apps/app/src/router.tsx",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-BE-4", "S4-FE-REGISTRY-1"],
    src: [
      "FRONTEND-12 §19 (UI-NOTI-SCREEN-004)",
      "API-07",
      "S4-NOTI-BE-3/BE-4 (GET/PATCH /notifications/events)",
      "audit FE screen-coverage 2026-07-08",
    ],
    done_when: [
      "NotificationEventsPage (/notifications/events): bảng catalog (module·code·name·status) + search/filter theo module/status + toggle is_enabled có confirm — PermissionGate view:notification-config (xem) / update:notification-config (toggle, ẩn/disable khi thiếu quyền)",
      "TÁI DÙNG GET /notifications/events + PATCH /notifications/events/:id (BE-3/BE-4) — KHÔNG BE mới; 6 cặp NOTI-config ĐÃ ở SENSITIVE_CAPABILITY_ALLOWLIST ⇒ KHÔNG đụng permission.service (crown); loading/error/empty; masking do server",
      "web-core api getNotificationEvents/updateNotificationEvent + spec; router.tsx wire route; i18n vi đủ key; FE spec (render + gating toggle)",
      "check.sh xanh; LIGHT gate (react-reviewer + quality-gate)",
    ],
  },
  {
    id: "S4-FE-NOTI-3",
    module: "NOTI",
    layer: "FE",
    title:
      "FE Notification Delivery Logs read-only (UI-NOTI-SCREEN-006): bảng append-only + filter channel/status/recipient/time — gate view:notification-delivery-log (đã allowlisted)",
    zone: "green",
    status: "todo",
    paths: [
      "apps/app/src/routes/notifications/**",
      "apps/app/src/router.tsx",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
    ],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-BE-3", "S4-FE-REGISTRY-1"],
    src: [
      "FRONTEND-12 §21 (UI-NOTI-SCREEN-006)",
      "API-07",
      "S4-NOTI-BE-3 (GET /notifications/delivery-logs)",
      "audit FE screen-coverage 2026-07-08",
    ],
    done_when: [
      "NotificationDeliveryLogsPage (/notifications/delivery-logs): bảng read-only (channel·status·recipient·created_at·error) + filter channel/status/recipient/time + pagination — PermissionGate view:notification-delivery-log",
      "TÁI DÙNG GET /notifications/delivery-logs (BE-3) — KHÔNG BE mới; KHÔNG nút Retry (chưa có BE retry endpoint — out-of-scope); loading/error/empty; masking do server",
      "web-core api getNotificationDeliveryLogs + spec; router.tsx wire; i18n vi; FE spec gating",
      "check.sh xanh; LIGHT gate (react-reviewer + quality-gate)",
    ],
  },

  // ─── Nhóm B: tách QA doable-now (chạy QA TASK/NOTI ngay, không chờ DASH-BE-2 như S4-QA-1) ───
  {
    id: "S4-QA-TASK-1",
    module: "QA",
    layer: "QA",
    title:
      "QA TASK permission/data-scope + deny-path (tách khỏi S4-QA-1 để chạy ngay): CRUD/assign/status-FSM/kanban/comment/checklist — coverage ≥80%",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/test/integration/**", "apps/api/src/tasks/**"],
    skills: ["code-review"],
    depends_on: ["S4-TASK-BE-4"],
    src: [
      "ISSUE-BOARD-01 §18 (TASK-QA)",
      "IMP02-STORY-106/107",
      "SPEC-06 §14",
      "S4-QA-1 (tách phần TASK khỏi WO gộp bị kẹt DASH)",
    ],
    done_when: [
      "Int-spec deny-path RED-first cho TASK: create/update/delete/assign/change-status(FSM)/priority/deadline/kanban-move/comment/checklist — thiếu cặp quyền → 403; data-scope Own/Team/Project (employee chỉ thao tác task được phép); cross-tenant → 404 (IDOR)",
      "FSM chuyển trạng thái sai bị chặn (SPEC-06 §14); watcher self-only; assign cảnh báo assignee-on-leave giữ nguyên; actor-exclusion nơi áp dụng",
      "Gate hasDb && LANE_DB, DB cô lập mediaos_qatask1 (int-spec khớp test/**/*.int-spec.ts — chạy thật, không false-green); coverage ≥80% lớp TASK nhạy cảm",
      "check.sh xanh; LIGHT gate (typescript-reviewer + quality-gate); nhánh permission chạm → security-reviewer soi deny-path",
    ],
  },
  {
    id: "S4-QA-NOTI-1",
    module: "QA",
    layer: "QA",
    title:
      "QA NOTI permission/own-scope + deny-path (tách khỏi S4-QA-1): own-scope/mark-read idempotent · intake dedupe/actor-exclusion · admin-config deny — coverage ≥80%",
    zone: "yellow",
    status: "todo",
    paths: ["apps/api/test/integration/**", "apps/api/src/notifications/**"],
    skills: ["code-review"],
    depends_on: ["S4-NOTI-BE-4"],
    src: [
      "ISSUE-BOARD-01 §18 (NOTI-QA)",
      "IMP02-STORY-106/107",
      "SPEC-08 §9",
      "S4-QA-1 (tách phần NOTI khỏi WO gộp bị kẹt DASH)",
    ],
    done_when: [
      "Int-spec RED-first NOTI: user chỉ đọc/mark-read notification CỦA MÌNH (own-scope), cross-user 404; mark-read idempotent (gọi 2 lần không lỗi, unread count đúng); intake dedupe (retry outbox không nhân đôi); actor-exclusion (người phát không tự nhận)",
      "Admin-config deny-path: thiếu view/update:notification-config → 403 GET/PATCH events/templates; thiếu view:notification-delivery-log → 403 delivery-logs; cross-tenant deny",
      "Gate hasDb && LANE_DB, DB cô lập mediaos_qanoti1 (chạy thật); coverage ≥80%",
      "check.sh xanh; LIGHT gate; nhánh permission → security-reviewer soi deny-path",
    ],
  },

  // ─── Nhóm C: harness + observability (độc lập, giá trị cao) ───
  {
    id: "S5-QA-GATE-LANEDB-1",
    module: "DEVOPS",
    layer: "QA",
    title:
      "Vá false-green cổng local: harness/check.sh chạy `pnpm test` KHÔNG set LANE_DB ⇒ ~70 int-spec deny-path/IDOR bị skip im lặng — làm cổng LOUD (đếm+in N spec SKIPPED, cảnh báo khi vượt ngưỡng) hoặc tự trỏ lane-DB khớp CI",
    zone: "yellow",
    status: "todo",
    paths: [
      "harness/check.sh",
      "harness/**",
      "apps/api/test/**",
      "docs/plans/S5-QA-GATE-LANEDB-1.md",
    ],
    skills: ["code-review"],
    plan: "docs/plans/S5-QA-GATE-LANEDB-1.md",
    depends_on: [],
    src: [
      "harness/check.sh:52 (step test pnpm test — KHÔNG set LANE_DB)",
      ".github/workflows/api.yml (CI đã set LANE_DB=mediaos 2026-07-10)",
      "memory ci-skips-most-integration-specs · turbo-cache-false-green",
    ],
    done_when: [
      "check.sh KHÔNG còn báo XANH khi hàng loạt int-spec bị skip im lặng: hoặc (a) in rõ 'N int-spec SKIPPED (thiếu LANE_DB)' + cảnh báo/đỏ khi N vượt ngưỡng, hoặc (b) tự set LANE_DB (lane-db-setup) để chạy như CI — chốt cách trong plan",
      "Đối xứng fix CI 2026-07-10: regression permission/IDOR KHÔNG lọt cổng local do test không chạy; dùng TURBO_FORCE khi cần bằng-chứng-xanh (bài học turbo-cache-false-green)",
      "KHÔNG phá luồng check.sh hiện có (lint/typecheck/test/smoke); nếu đổi hành vi mặc định → cập nhật CLAUDE.md §9",
      "check.sh tự chạy xanh; LIGHT gate",
    ],
  },
  {
    id: "S5-FND-JOBS-OBS-1",
    module: "FOUNDATION",
    layer: "BE",
    title:
      "System Jobs observability: GET /foundation/system-jobs đọc lịch sử system_job_runs (retention/temp-cleanup: last-run/status/duration/error) + màn FE read-only — khớp cặp seed orphan view:foundation-job (hiện 0 endpoint)",
    zone: "yellow",
    status: "todo",
    paths: [
      "apps/api/src/foundation/**",
      "apps/api/src/scheduler/**",
      "apps/api/test/integration/**",
      "packages/contracts/src/**",
      "apps/app/src/routes/system/**",
      "apps/app/src/i18n/**",
      "packages/web-core/src/lib/**",
      "docs/plans/S5-FND-JOBS-OBS-1.md",
    ],
    skills: ["code-review"],
    plan: "docs/plans/S5-FND-JOBS-OBS-1.md",
    depends_on: [],
    src: [
      "FOUNDATION-SYSTEM-AUDIT-2026-07-02 §5.2/§6.3 (admin surface thiếu; view:foundation-job orphan seed 0435)",
      "DB-08 §8.14 (system_job_runs)",
      "apps/api/src/scheduler/job-run-logger.ts (ghi, chưa có đường đọc)",
    ],
    done_when: [
      "GET /foundation/system-jobs (+ /:jobName/runs) đọc system_job_runs: job name·last run·status·started/finished·duration·error tóm tắt — @RequirePermission view:foundation-job (cặp đã seed 0435; PermissionGuard class-level BẮT BUỘC — guard không global); read-only, KHÔNG trigger job (POST run = red, out-of-scope)",
      "Đọc ĐÚNG phạm vi (GLOBAL/no-tenant hay company-scoped tuỳ schema) — KHÔNG rò lịch sử job công ty khác; DTO contracts dual-build; error message scrub secret (job-error-scrubber sẵn có)",
      "FE SystemJobsPage (/system/jobs) read-only: bảng job + trạng thái + last-run, PermissionGate view:foundation-job; loading/error/empty; i18n vi",
      "Int-spec RED-trước: thiếu view:foundation-job → 403; đúng phạm vi tenant/global; check.sh xanh; LIGHT gate (chạm masking error → security-reviewer)",
    ],
  },

  // ─── Nhóm D: NOTI wiring crown (generic OutboxNotificationBridge — depends_on S4-INT-1) ───
  {
    id: "S4-INT-3",
    module: "INT",
    layer: "BE",
    title:
      "Tích hợp LEAVE → NOTI qua OutboxNotificationBridge (INT-1): event-type leave.request.{submitted,approved,rejected,cancelled,revoked} → NOTI intake, recipient §9.4 — hiện event LEAVE rơi im lặng, requester không được báo",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/leave/**",
      "apps/api/src/notifications/**",
      "apps/api/src/events/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-INT-3.md",
    ],
    skills: ["code-review"],
    plan: "docs/plans/S4-INT-3.md",
    depends_on: ["S4-INT-1"],
    src: [
      "IMP02-STORY-102 (P0)",
      "SPEC-08 §9.4/§9.5",
      "notification-event-catalog.const.ts (LEAVE_REQUEST_*)",
      "tiền lệ consumer attendance-leave-sync",
      "leave-approval.service.ts (producer outbox đã phát, chưa ai tạo notification)",
    ],
    done_when: [
      "Đăng ký event-type LEAVE (submitted/approved/rejected/cancelled/revoked) + recipient-resolver vào OutboxNotificationBridge (INT-1) — KHÔNG tự dựng consumer riêng (owner chốt generic bridge); map outbox eventType (dạng chấm) → NOTI eventCode (LEAVE_REQUEST_*) lấy VERBATIM từ notification-event-catalog.const.ts (bài học code-drift)",
      "Recipient đúng §9.4: approved/rejected/cancelled/revoked → requester (payload.userId); submitted → approver theo cây duyệt; LOẠI actor; dedupe + delivery log; recipient cùng company (KHÔNG rò cross-tenant)",
      "consumerName/registration DUY NHẤT toàn hệ; append vào bridge wiring (KHÔNG rewrite khối INT-1); serialize merge sau INT-1",
      "Int-spec RED-trước: mỗi event → đúng số notification & recipient · actor không tự nhận · idempotent khi retry outbox · cross-tenant deny; FULL gate security-reviewer + silent-failure-hunter PASS",
    ],
  },
  {
    id: "S4-INT-4",
    module: "INT",
    layer: "BE",
    title:
      "Tích hợp ATT → NOTI: bổ sung producer outbox trong ATT (adjustment submit/approve/reject · remote-work submit/approve/reject/cancel) + đăng ký event-type + recipient-resolver vào OutboxNotificationBridge — ATT hiện CHƯA phát event nào",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/attendance/**",
      "apps/api/src/notifications/**",
      "apps/api/src/events/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-INT-4.md",
    ],
    skills: ["code-review"],
    plan: "docs/plans/S4-INT-4.md",
    depends_on: ["S4-INT-1"],
    src: [
      "IMP02-STORY-102 (P0)",
      "SPEC-08 §9.4/§9.5",
      "notification-event-catalog.const.ts (ATTENDANCE_*/ADJUSTMENT_*)",
      "S3-ATT-BE-4/BE-5 (adjustment · remote-work đã build)",
    ],
    done_when: [
      "Producer: ATT service phát event outbox cho adjustment (submitted/approved/rejected) + remote-work (submitted/approved/rejected/cancelled) — outbox.enqueue TRONG cùng tx nghiệp vụ (KHÔNG đụng attendance_logs append-only), payload gồm eventCode + recipient key (requester/approver)",
      "Đăng ký event-type + recipient-resolver vào OutboxNotificationBridge (INT-1); map eventType→eventCode VERBATIM từ catalog; recipient §9.4 (approve/reject → requester · submit → approver); LOẠI actor; cùng company",
      "consumerName/registration duy nhất; append wiring; serialize merge sau INT-1; dedupe + delivery log",
      "Int-spec RED-trước: mỗi hành động ATT → đúng notification & recipient · actor loại · idempotent · cross-tenant deny; FULL gate security-reviewer + silent-failure-hunter PASS",
    ],
  },
  {
    id: "S4-INT-5",
    module: "INT",
    layer: "BE",
    title:
      "Tích hợp HR/AUTH → NOTI: HR tạo employee → activation/welcome notification (mảnh thiếu STORY-098) + AUTH password-reset-requested/account-locked → notify chủ tài khoản — producer HR/AUTH + đăng ký vào OutboxNotificationBridge",
    zone: "red",
    status: "todo",
    paths: [
      "apps/api/src/employees/**",
      "apps/api/src/auth/**",
      "apps/api/src/notifications/**",
      "apps/api/src/events/**",
      "apps/api/test/integration/**",
      "docs/plans/S4-INT-5.md",
    ],
    skills: ["code-review"],
    plan: "docs/plans/S4-INT-5.md",
    depends_on: ["S4-INT-1"],
    src: [
      "IMP02-STORY-098 (P0 activation notification) + 102",
      "SPEC-08 §9.4/§9.5",
      "notification-event-catalog.const.ts",
      "S2-INT-1 (HR↔AUTH provision đã build — NOTI chưa tồn tại lúc đó)",
    ],
    done_when: [
      "Producer: HR create employee (S2-INT-1) phát event activation/welcome; AUTH phát password-reset-requested + account-locked — outbox.enqueue trong tx; payload eventCode + recipient (chủ tài khoản/nhân sự vừa tạo)",
      "Đăng ký event-type + recipient-resolver vào OutboxNotificationBridge (INT-1); map eventCode VERBATIM; account-locked notify KHÔNG lộ chi tiết bảo mật nhạy cảm; cùng company",
      "consumerName duy nhất; append wiring; serialize merge; dedupe + delivery log; plan-reviewer TRƯỚC khi code (crown-AUTH)",
      "Int-spec RED-trước: tạo employee → 1 activation notification đúng recipient · reset/lock → notify đúng chủ tài khoản · actor loại nơi áp dụng · idempotent · cross-tenant deny; FULL gate security-reviewer + silent-failure-hunter + plan-reviewer PASS",
    ],
  },
];
