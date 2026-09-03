import { fileURLToPath } from "node:url";
import swc from "unplugin-swc";
import { configDefaults, defineConfig } from "vitest/config";
import { resolveTestDbUrls } from "./test/db-target";

// Build the test env. DB đích do `test/db-target.ts` resolve — FAIL-CLOSED (S6-SEC-DBFENCE-1 / KI-028):
// KHÔNG còn fallback `?? "mediaos"` (= DB PROD của .env/.env.prod). Thiếu LANE_DB và không có URL tường
// minh ⇒ 3 URL rỗng ⇒ `hasDb` false ⇒ int-spec SKIP (unit test vẫn chạy). Trỏ vào DB được bảo vệ
// (mediaos / mediaos_dev) ngoài CI ⇒ THROW. Đọc phần đầu `test/db-target.ts` để biết vì sao.
// Vitest's `env` literals override process.env, so resolving here (Node config ctx, where process.env
// is authoritative) is what makes LANE_DB take effect.
function laneDbEnv(): Record<string, string> {
  const { DATABASE_URL, DATABASE_DIRECT_URL, DATABASE_WORKER_URL } = resolveTestDbUrls(process.env);
  return {
    DATABASE_URL,
    DATABASE_DIRECT_URL,
    DATABASE_WORKER_URL,
    // G6-2g: int-specs construct SecretRotationService for real. The bypass-RLS guard fail-closes unless
    // this is exactly 'true'. mediaos_worker is non-superuser so the guard is inert here, but set it so
    // the harness is robust if DATABASE_WORKER_URL ever falls back to the superuser direct pool.
    ALLOW_SUPERUSER_ROTATION: "true",
    JWT_SECRET: "test-secret-test-secret-test-secret-test-secret",
    // G16-1b: tắt 2FA-enforcement guard cho harness e2e cũ (admin mock đăng nhập KHÔNG enroll 2FA — bật sẽ
    // 403 mọi route admin). Logic DENY của guard vẫn được phủ ở unit-test (set 'true' tường minh) + tích phân
    // riêng. Prod/staging KHÔNG đặt biến này → default 'true' (BẬT). Chỉ là kill-switch cho test fixtures cũ.
    TWO_FACTOR_ENFORCEMENT_ENABLED: "false",
    // G6-2e: int-specs construct LocalKekProvider for real → must point at the dev KEK. vitest cwd is
    // apps/api, so the env.schema default '.secrets/local-kek.bin' (relative) would miss the repo-root
    // file. Resolve an absolute path from this config's location instead.
    KMS_PROVIDER: "local",
    KMS_LOCAL_KEK_PATH: fileURLToPath(new URL("../../.secrets/local-kek.bin", import.meta.url)),
  };
}

// SWC giữ decorator metadata cho DI của Nest trong test (esbuild của Vitest không emit metadata).
export default defineConfig({
  envDir: ".",
  test: {
    globals: true,
    environment: "node",
    root: ".",
    // *.int-spec.ts = integration (Postgres thật) — tự skip khi không có DATABASE_URL (xem helpers/integration-db).
    // *.unit-spec.ts = unit test của HẠ TẦNG TEST đặt trong test/ (không cần DB). Không khai glob này thì
    // spec trong test/ KHÔNG BAO GIỜ chạy = xanh-giả (memory: vitest-unit-specs-must-be-colocated).
    include: [
      "src/**/*.spec.ts",
      "test/**/*.e2e-spec.ts",
      "test/**/*.int-spec.ts",
      "test/**/*.unit-spec.ts",
    ],
    // S6-SEC-DBFENCE-1 (KI-028) — cổng DUY NHẤT chặn suite chạy vào DB PROD. Xem test/global-setup.ts.
    // S7-QA-CATALOGFIXTURE-1 — đai 2 chống fixture đóng dấu catalog `permissions` (toàn cục, không có
    // company_id nên cleanupTenants không dọn). THỨ TỰ CÓ Ý NGHĨA: db-fence chạy TRƯỚC để mọi kết nối
    // sau nó đã qua kiểm "đúng lane DB"; catalog-fence chỉ chụp/đối chiếu.
    globalSetup: ["./test/global-setup.ts", "./test/global-catalog-fence.ts"],
    // DE-MEDIA-FY (CLAUDE.md reframe 2026-06-20 · S1-QA-DEBT-1): test của module OUT-OF-SCOPE — finance
    // theo-kênh (cost/revenue/cost-allocation) + workflow-DAG (content/project/channel lifecycle). Code đã
    // PARK (không phát triển, không xoá đợt này) ⇒ test của chúng fail-giả che phạm vi THẬT của suite.
    // Exclude (KHÔNG xoá) để dễ un-park sau. KHÔNG đụng approval-FSM (workflow phê duyệt LEAVE/ATT = IN scope).
    // OUT-OF-MVP / Phase-defer (S1-INT-MOUNT-1 — quyết theo SPEC-01 §7.2 + Phase 5): module CHƯA dựng tầng
    // app (route trả 404, KHÔNG phải lỗi) ⇒ exclude deny-test có VÉ PHASE; un-exclude khi build module:
    //   • webhooks-deny → INTEGRATION = Phase 5 (SPEC-01 §7.2/Phase 5, cùng MOBILE/AI).
    //   • ui-config-deny (branding/ui-navigation/i18n-override) → KHÔNG thuộc 7 module MVP (SPEC-01 §7.1);
    //     tùy-biến-giao-diện = giai đoạn sau. (Owner muốn đưa vào MVP → đó là WO BUILD module, không phải mount.)
    exclude: [
      ...configDefaults.exclude,
      // de-media-fy (parked — CLAUDE.md reframe)
      // ⓘ Mục workflow-lifecycle.e2e-spec (test/) ĐÃ XOÁ HẲN ở S10-CLEAN-WORKFLOWCLUSTER-2 — nó gọi
      // /workflow/* vốn đã bị gỡ ở đợt trước. Exclude một file không tồn tại làm cổng tự-kiểm của
      // route-http-coverage so lệch hai tập ⇒ phải gỡ ở CẢ HAI chỗ cùng lúc.
      // ⛔ KHÔNG viết lại tên file trong ngoặc KÉP ở comment này: cổng tự-kiểm rút MỌI chuỗi
      // trong khối `exclude:` bằng regex, kể cả chuỗi nằm trong comment ⇒ nó tưởng mục đã gỡ
      // vẫn còn và ĐỎ. (Đã vấp đúng một lần khi viết bản vá này.)
      "test/integration/finance-cost-controller-deny.int-spec.ts",
      "test/integration/finance-cost-allocation-controller-deny.int-spec.ts",
      "test/integration/finance-revenue-controller-deny.int-spec.ts",
      // out-of-MVP / Phase-defer (S1-INT-MOUNT-1)
      "test/integration/webhooks-deny.int-spec.ts",
      "test/integration/ui-config-deny.int-spec.ts",
    ],
    // Integration test mở/đóng pool + chạy DDL → nới timeout mặc định.
    testTimeout: 20000,
    hookTimeout: 30000,
    // Force direct-postgres URL for tests — PgBouncer's auth_query setup requires
    // a userlist.txt generated by setup-db-roles.mjs (not committed).
    // mediaos_app connects directly so RLS is still enforced (role has no BYPASSRLS).
    //
    // PARALLEL LANES (TASKS §5 / MEMORY mediaos-shared-db-drift): each lane MUST verify on its OWN
    // isolated DB `mediaos_<lane>` — drizzle's monotonic-by-`when` migrator SKIPS lower-band migrations
    // forever once a higher band migrates the SHARED `mediaos`, so band-0070s tables would be absent ⇒
    // false green/red. We therefore read the target DB from process.env FIRST (LANE_DB or an explicit
    // DATABASE_URL passed by the lane-db harness); the literals below are only the CI/master fallback.
    // Vitest's `env` literals OVERRIDE process.env, so each URL is resolved here in config (Node ctx)
    // where process.env is authoritative.
    env: laneDbEnv(),
    coverage: {
      provider: "v8",
      // Scoped thresholds (CLAUDE.md §6: "coverage ≥80% — ngưỡng riêng cho module nhạy cảm").
      //
      // LUẬT: khoá là ĐƯỜNG DẪN CHÍNH XÁC tới một file CÓ THẬT (per-file semantics). Khoá không khớp
      // file nào bị vitest **bỏ qua trong im lặng** — không cảnh báo, không đỏ — nên nó là một cổng
      // CHẾT trông y hệt cổng sống. Đã đo ở `S13-PAYROLL-QA-1` (2026-09-01): 5/7 khoá lúc đó trỏ vào
      // file không tồn tại (4 khoá `src/workflow/*` — module ĐÃ XOÁ HẲN — và một khoá payroll gõ
      // nhầm số ít/số nhiều). Bốn khoá workflow đã gỡ ở đây; khoá payroll đã sửa bên dưới.
      // ⚠️ Đổi tên/di chuyển file crown-jewel ⇒ PHẢI sửa khoá tương ứng trong CÙNG commit.
      // ⓘ S14-QA-COVGATE-1 (2026-09-02): script `test:cov` (package.json) cũng trỏ vào `src/workflow`
      //   đã xoá — đó là nợ ghi ở đây trước đó. Đã XOÁ script đó (không còn phạm vi mặc định hợp lý:
      //   mỗi module nhạy cảm giờ có script riêng `test:cov:<module>`, và chạy `--coverage` toàn repo
      //   không `--coverage.include` sẽ VI PHẠM đúng bất biến ghi ở dòng ~239 dưới đây). Thêm ratchet
      //   tự-kiểm `test/foundation/coverage-thresholds-ratchet.unit-spec.ts`: đọc khoá `thresholds` này
      //   qua AST (không regex — tránh bẫy đọc nhầm chuỗi trong comment) + quét mọi script `test:cov:*`
      //   còn lại, assert từng khoá/đường dẫn trỏ file/thư mục CÓ THẬT.
      //
      // Chỉ có hiệu lực khi truyền `--coverage`, và chỉ CẮN khi file lọt vào `--coverage.include` của
      // lượt chạy đó ⇒ mỗi module nhạy cảm có script riêng (`test:cov:payroll`, `test:cov:sensitive`…).
      thresholds: {
        // G12-1 → SỬA Ở `S13-PAYROLL-QA-1` (2026-09-01): khoá cũ ghi `salary-profile.service.ts`
        // (SỐ ÍT) trong khi file thật tên `salary-profiles.service.ts` (SỐ NHIỀU) ⇒ cổng crown-jewel
        // này **chưa từng đo file nào** kể từ G12. Vitest lặng lẽ bỏ qua khoá không khớp file nào
        // (đã kiểm: các lượt `--coverage` ở WO này KHÔNG đỏ dù 5/7 khoá trỏ vào file không tồn tại),
        // nên lỗi chính tả kiểu này không có cổng nào bắt — cùng họ với `index-ratchet-must-pin-
        // definition-not-name`. Enforce bằng `pnpm --filter @mediaos/api test:cov:payroll` (LANE_DB).
        //
        // Ngưỡng đặt theo SỐ ĐO 2026-09-01 dưới `test:cov:payroll` (372 ca): 98.75% stmts/lines ·
        // 100% funcs · **76.74% branches**. Branch để 75 là RATCHET có chủ ý, không phải hạ chuẩn:
        // v8 đếm cả nhánh `??`/`?.` không tới được bằng đường HTTP. Nâng lên khi có ca mới, đừng hạ.
        "src/payroll/salary-profiles.service.ts": {
          lines: 90,
          functions: 90,
          branches: 75,
          statements: 90,
        },
        // Ba file crown-jewel THUẦN của PAYROLL (FSM + lớp phạm vi/tầng-guard-2 + duyệt four-eyes).
        // Số đo cùng lượt: fsm 100/100/100 · access 100/100/100 · approval 98.27 stmts / 90.69 branch.
        "src/payroll/payroll-fsm.ts": {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        "src/payroll/payroll-access.service.ts": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        "src/payroll/payroll-approval.service.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        // S1-FND-SETTING-1: SettingService is crown-jewel (validation_schema + secret-mask + audit-in-tx,
        // CLAUDE.md §6 module nhạy cảm) → ≥80% on all axes. Fully unit-tested (no-DB) so per-file gate is
        // safe (unlike controller/repo exercised only by int-specs). Exact path = per-file semantics.
        "src/foundation/settings/setting.service.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        // S2-QA-1: DataScopeService is crown-jewel (permission data-scope resolver — Own/Team/Dept/Company/
        // System predicate + resolveStrongestScope exact>wildcard, fail-closed null; CLAUDE.md §6 module nhạy
        // cảm) → ≥80% on all axes. Fully unit-tested in the no-DB run via data-scope.service.spec.ts +
        // data-scope.service.coverage.spec.ts (measured 98.83% stmts / 88% branches) so a per-file gate is
        // safe here. Exact path = per-file semantics.
        // S6-SEC-IDENTITY-PROJ-1: `identity-projection.ts` là crown-jewel THUẦN (dựng vị từ quyết định
        // cột danh tính có hiện hay không) và unit-test được toàn bộ KHÔNG cần DB ⇒ bar cao như
        // `dag-validator.service.ts`, không phải 80. Nó cũng KHÔNG rơi vào bẫy "inert vì int-spec skip"
        // mà các khối dưới đây phải né: `identity-projection.spec.ts` chạy ở lần `pnpm test` mặc định.
        "src/permission/identity-projection.ts": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        "src/permission/data-scope.service.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        // S2-QA-1-FIX-B: crown-jewel auth/permission services ARE per-file gated ≥80% (DoD §6, hard block).
        // Vitest per-file thresholds bite ONLY when the file appears in the coverage report (verified: the
        // salary/setting thresholds above are no-ops under a run whose `--coverage.include` never matches
        // those two files — e.g. `test:cov:payroll`/`test:cov:sensitive` don't include them either). So
        // these two gates are ENFORCED by `test:cov:sensitive` (which --coverage.include
        // both files AND runs their flows under an isolated LANE_DB), and are inert in the default no-DB unit run
        // (`pnpm test`) where the auth/permission *.int-spec.ts skipIf(!(hasDb && LANE_DB)) — no false-red.
        //   • permission.service.ts: can()/scope/userGrantsPermissionIds/listGrantableScopes covered at UNIT
        //     level (permission.service.spec.ts + permission.scopes.spec.ts + permission.coverage.spec.ts).
        //   • auth.service.ts: login/refresh/logout/2FA/me/forgot/reset/changePassword/disableTwoFactor flows
        //     covered by auth*.int-spec.ts under LANE_DB.
        // Measured under LANE_DB: auth.service.ts 85%+ stmts / 82%+ branch; permission.service.ts 90%+ both.
        "src/auth/auth.service.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        "src/permission/permission.service.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        // S14-PERF-DASHACTOR-1: `permission.decide.ts` giữ TOÀN BỘ thân quyết định quyền dưới dạng hàm
        // THUẦN — `decideCan` (can/canBatch) từ HR-PERF-1 và nay cả `decideStrongestScope`
        // (resolveStrongestScope/resolveStrongestScopes). Nó KHÔNG có khoá threshold nào và KHÔNG nằm
        // trong `--coverage.include` của bất kỳ script nào ⇒ logic crown-jewel đã nằm NGOÀI cổng từ
        // HR-PERF-1, im lặng (họ `coverage-threshold-key-typo-is-dead-gate`). Khoá này + include mới ở
        // `test:cov:sensitive` đóng lỗ đó. Unit-test được TOÀN BỘ không cần DB (permission.service.spec ·
        // data-scope.service.spec · test/foundation/permission-scope-batch.unit-spec) nên bar 80 mọi trục
        // là an toàn, không rơi vào bẫy "inert vì int-spec skip".
        "src/permission/permission.decide.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        // S2-AUTH-BE-5-FIX (same enforcement model as S2-QA-1-FIX-B above): the 4 NEW auth-log-viewer
        // crown-jewel files (read security data + Company-scope RLS + jsonb masking) ARE per-file gated ≥80%
        // on all axes (CLAUDE.md §6 "permission/auth — ngưỡng riêng module nhạy cảm"; DoD §8 hard block).
        // Vitest per-file thresholds bite ONLY when the file appears in the coverage report, so these gates
        // are ENFORCED by `test:cov:sensitive` (which --coverage.include all 4 files AND drives their flows via
        // auth-logs-viewer.int.spec.ts under an isolated LANE_DB), and are inert in the default no-DB unit run
        // (`pnpm test`) where that int-spec skipIf(!(hasDb && LANE_DB)) — no false-red. Measured under LANE_DB:
        // all 4 files 100% lines/functions/statements; branches: controller 100% · service 100% · login-log
        // repo 100% · security-event repo 100% (filter/sort/date branches driven by V7/R8/E9/S10/S11).
        "src/auth/auth-logs-viewer.controller.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        "src/auth/auth-logs-viewer.service.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        "src/auth/login-log.repository.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        "src/auth/security-event.repository.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        // S18-AUTH-UNLOCK429-1 — file này TRƯỚC NAY nằm ngoài MỌI `--coverage.include`, tức bộ chặn
        // brute-force + đường GỠ khoá 429 không có cổng coverage nào đo. Ngưỡng đặt theo SỐ ĐO THẬT
        // 2026-09-03 dưới `test:cov:sensitive` (LANE_DB): 100% stmts/lines/funcs · 98.94% branches.
        // Để 90 cho branches là biên cho nhánh `??`/`?.` mà v8 đếm nhưng không tới được — nâng khi có
        // ca mới, ĐỪNG hạ.
        "src/auth/login-rate-limiter.ts": {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        // S7-CALL-QA-1 (cùng mô hình cưỡng chế như S2-QA-1-FIX-B ở trên): ngưỡng per-file chỉ CẮN khi file
        // xuất hiện trong report, nên hai khối này **inert** ở lần chạy unit mặc định (`pnpm test`, không
        // LANE_DB ⇒ int-spec skipIf) và được CƯỠNG CHẾ bởi `test:cov:call` — script đó `--coverage.include`
        // đúng 3 file `call-signalling*` + cụm `chat-call*`, và chạy luồng của chúng dưới LANE_DB cô lập.
        //
        // 🔴 ĐIỀU KIỆN để hai khối này không cắn NHẦM: **không job nào được chạy `--coverage` mà thiếu
        // `--coverage.include`**. Đó là kịch bản duy nhất kéo `call-signalling.gateway.ts` vào report ở một
        // lần chạy KHÔNG có LANE_DB (int-spec skip) ⇒ branch tụt dưới 80 ⇒ ĐỎ OAN. Đã kiểm 11/08/2026:
        // `grep -rn coverage .github/workflows/` = 0 hit và `test:cov*` không được gọi ở CI ⇒ hiện an toàn.
        // Ai thêm job coverage sau này PHẢI đọc mục này (plan `S7-CALL-QA-1.md` §3.3).
        //
        // ⚠️ Và nói thẳng giới hạn: vì CI KHÔNG chạy coverage ở bất kỳ job nào, đây là **ratchet chạy TAY**
        // — nó chặn được người cố ý đo, KHÔNG chặn được PR của người không đo.
        //
        // Đo 11/08/2026 sau nhóm A–D: gateway 100 lines/stmts/funcs · branch 92.74 (trước WO: 82.34 / 68.67);
        // filter 100 cả bốn trục (trước WO: 21.73 stmts / 50 funcs — thân `catch()` chưa từng chạy).
        // Ngưỡng đặt DƯỚI số đo một quãng để không đỏ vì nhiễu, nhưng đủ chặt để một bản gỡ test là ĐỎ.
        "src/realtime/call-signalling.gateway.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        // Filter là 47 dòng, không có nhánh khó — giữ đúng 100 để mọi bản "gỡ `@UseFilters` cho gọn" đỏ ngay.
        "src/realtime/call-signalling.filter.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
  plugins: [swc.vite()],
});
