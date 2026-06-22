export const meta = {
  name: 'auto-loop',
  description:
    'Vòng tự động end-to-end MediaOS theo MÔ HÌNH 3 ĐỘI + phản hồi (KHÔNG chia theo màu): Đội 1 (Phân tích & Kế hoạch) phân rã 1 Work Order READY thành bước nhỏ + lane + tiêu chí nghiệm thu + task kiểm thử → Đội 2 (Thực thi) implement RED→GREEN → Đội 3 (Kiểm tra & Review) đối chiếu yêu cầu + chạy test: PASS→đánh dấu xong (lights-out auto-merge, degrade trung thực nếu branch protection chặn); FAIL→trả problem về Đội 1 re-analyze → tạo task sửa → lặp tới maxReviewIterations. Trợ lý progress-tracker đóng dấu thời gian. Mặc định dryRun (chỉ in kế hoạch đội, KHÔNG mutate). Bất biến CLAUDE.md §2 vẫn do hook ép — KHÔNG bỏ.',
  phases: [
    { title: 'Analyze', detail: 'Đội 1 (CÓ ĐIỀU KIỆN — chỉ WO đỏ/đa-domain): phân rã → lane + nghiệm thu + task test. WO rõ/đơn-domain → build THẲNG, bỏ qua Đội 1.' },
    { title: 'PlanReview', detail: 'plan-reviewer duyệt kế hoạch trước khi code (chỉ lane nhạy cảm)' },
    { title: 'Build', detail: 'Đội 2: builder (db nối tiếp trước) implement + viết test RED→GREEN, self-heal retry' },
    { title: 'Review', detail: 'Đội 3: completion-evaluator + qa + (security nếu nhạy cảm) đối chiếu nghiệm thu — PASS/FAIL' },
    { title: 'Re-analyze', detail: 'Đội 1 nhận FAIL → tìm hướng xử lý → tạo task sửa (vòng phản hồi)' },
    { title: 'Ship', detail: 'PASS → ledger done + commit/push/PR + auto-merge (degrade nếu protection chặn)' },
  ],
};

// ─────────────────────────── Tham số (qua args) ───────────────────────────
// MẶC ĐỊNH AN TOÀN: dryRun=true → chỉ phân tích + in "đội nào làm gì", KHÔNG implement/commit/push/merge.
// Chạy thật: args = { dryRun:false }.
// ⚠️ Runtime giao `args` dưới dạng CHUỖI JSON (typeof args === 'string'), KHÔNG phải object.
//    Phải parse trước, nếu không mọi args.* = undefined ⇒ luôn dryRun + luôn fallback.
const A = typeof args === 'string' ? (() => { try { return JSON.parse(args || '{}'); } catch { return {}; } })() : args || {};
const dryRun = A.dryRun !== false; // mặc định true; chỉ false khi truyền tường minh dryRun:false
const only = A.only ? String(A.only) : null; // lọc id WO (regex) — vd '^FOUNDATION-BE'
const MAX_ROUNDS = A.maxRounds || 8; // trần số Work Order xử lý/lần chạy
const MAX_REVIEW = A.maxReviewIterations || 3; // trần vòng phản hồi Đội3→Đội1 trước khi giao người
const MAX_RETRY = A.maxRetry || 2; // self-heal retry mỗi lane trong 1 vòng build
const AUTO_MERGE = A.autoMerge !== false; // lights-out: PASS → auto-merge (mặc định BẬT)
// Đích merge cho lights-out. Mặc định nhánh tích hợp wave (KHÔNG master — branch protection master cần người).
const MERGE_BASE = A.mergeBase || 'feat/foundation-wave1';
const MIN_BUDGET = 60_000; // còn dưới mức này → dừng-có-trạng-thái
// Danh sách READY tính SẴN (truyền qua args) — Claude chọn việc trước, KHÔNG tốn Đội 1 chỉ để CHỌN việc.
// shape mỗi item: { id, title, zone, paths, done_when }. KHÔNG truyền → Đội 1 tự tìm (fallback hành vi cũ).
const providedWOs = Array.isArray(A.workOrders) ? A.workOrders : null;
const GATE = A.gate || 'red'; // 'red' = chỉ WO đỏ tốn Đội 1 · 'red+yellow' = cả vàng

// Nhận diện việc NHẠY CẢM (thay cho "màu"): quyết model (Opus) + reviewer (security FULL gate) — KHÔNG còn để GATE người.
// Mọi việc đều qua Đội 3; "nhạy cảm" chỉ làm review SÂU hơn + model mạnh hơn, không chặn loop.
// Title keywords. BỎ bare 'migration' (việc migration thật → builder='db-migration' + path migrations/ đã bắt;
// 'migration-check'/'migration-band' trong title CI/prose KHÔNG chạm migration → tránh false-positive như S0-CI-1).
// 'token' KHÔNG bắt khi đứng sau 'design' (design token = token UI, KHÔNG phải auth token) — tránh false-positive S0-FE-CORE-1.
const SENSITIVE = /permission|\brls\b|policy|secret|encrypt|\bkms\b|audit|\bauth\b|(?<!design[\s-])tokens?|backfill|workflow|approval|\bfsm\b|payroll|payslip/i;
// Root app FE — masking do server, hiếm khi crown; THƯ MỤC tên 'auth' (apps/auth) ≠ logic auth → loại khỏi path-check.
const FE_ROOT = /^(apps\/(auth|console|app)|packages\/(ui|web-core))(\/|$)/i;
// Path nhạy cảm = SEGMENT backend/db rõ ràng (KHÔNG tính tên app FE). Neo theo dấu '/' để 'apps/auth' không khớp 'auth'.
const SENSITIVE_PATH = /(?:^|\/)(migrations?|permissions?|audit|secrets?|policy|rls|rbac)(?:[/.]|$)|apps\/api\/.*\/(auth|token|session|password|policy)/i;
const isSensitive = (lane) =>
  lane.builder === 'db-migration' ||
  SENSITIVE.test(lane.task || '') ||
  (lane.paths || []).some((p) => !FE_ROOT.test(p) && SENSITIVE_PATH.test(p));

// ─── Cổng TRIAGE: Đội 1 chỉ chạy CÓ ĐIỀU KIỆN (việc khó); việc rõ → build thẳng ───
// builder theo DOMAIN của path: db/migration→db-migration · FE/.tsx→frontend-builder · còn lại→backend-builder.
const domainOf = (paths) => {
  const p = (paths || []).join(' ');
  if (/migration|schema|\/db\//i.test(p)) return 'db-migration';
  if (/\.tsx|apps\/(app|console|auth)|packages\/ui|web-core/i.test(p)) return 'frontend-builder';
  return 'backend-builder';
};
// needsPlanning: WO có CẦN Đội 1 phân rã không?
//   ĐỎ (khó/crown) · HOẶC chạm >1 domain (cần tách lane) · HOẶC gate='red+yellow' & vàng → CÓ. Còn lại build thẳng.
const needsPlanning = (wo) => {
  if (wo.zone === 'red') return true;
  if (GATE === 'red+yellow' && wo.zone === 'yellow') return true;
  const doms = new Set((wo.paths || []).map((p) => domainOf([p])));
  return doms.size > 1;
};

// ─── SONG SONG (opt-in): chạy nhiều WO cùng lúc nếu KHÔNG đụng nhau ───
// maxConcurrent>1 bật chế độ song song (chỉ khi có queue + live). Mỗi WO 1 worktree riêng (off MERGE_BASE).
const MAX_CONCURRENT = Math.max(1, A.maxConcurrent || 1);
const KEEP_WORKTREE = A.keepWorktree === true; // mặc định tự gỡ worktree sau merge
// prefix tĩnh của glob = phần trước ký tự wildcard đầu tiên (bỏ '/' cuối). '' = khớp mọi nơi (xung đột tất).
const staticPrefix = (glob) => {
  const g = String(glob);
  const i = g.search(/[*?{}[\]]/);
  return (i === -1 ? g : g.slice(0, i)).replace(/\/+$/, '');
};
const touchesMigration = (wo) => (wo.paths || []).some((p) => /migrations?\b|\/db\/schema/i.test(p));
// hai paths chồng nhau nếu prefix này là tổ tiên/bằng prefix kia (hoặc một bên rỗng = khớp tất).
const pathsOverlap = (a, b) => {
  const PA = (a.paths || []).map(staticPrefix);
  const PB = (b.paths || []).map(staticPrefix);
  return PA.some((pa) => PB.some((pb) => pa === '' || pb === '' || (pa + '/').startsWith(pb + '/') || (pb + '/').startsWith(pa + '/')));
};
// XUNG ĐỘT (không chạy song song được): paths chồng nhau · HOẶC cả hai chạm migration (đánh số nối tiếp head).
const conflict = (a, b) => pathsOverlap(a, b) || (touchesMigration(a) && touchesMigration(b));
const worktreePath = (id) => `../mediaos-${String(id).toLowerCase()}`; // sibling repo, off MERGE_BASE
// Gom item thành "wave" không-xung-đột (xem trước cho dryRun; scheduler LIVE chạy động, mượt hơn).
function scheduleWaves(items, cap) {
  const rest = [...items];
  const waves = [];
  while (rest.length) {
    const wave = [];
    for (let i = 0; i < rest.length && wave.length < cap; ) {
      if (wave.some((w) => conflict(w, rest[i]))) {
        i++;
        continue;
      }
      wave.push(rest.splice(i, 1)[0]);
    }
    waves.push(wave);
  }
  return waves;
}

// ─────────────────────────── Schemas (ép agent trả data) ──────────────────
const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['done'],
  properties: {
    done: { type: 'boolean', description: 'true nếu KHÔNG còn Work Order READY actionable (đã loại exclude)' },
    workOrder: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title', 'paths'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } },
      },
    },
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'task', 'builder'],
        properties: {
          id: { type: 'string' },
          task: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          builder: { type: 'string', enum: ['backend-builder', 'frontend-builder', 'db-migration'] },
        },
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    acceptanceChecks: { type: 'array', items: { type: 'string' }, description: 'tiêu chí NGHIỆM THU Đội 3 đối chiếu (đo được)' },
    testTasks: { type: 'array', items: { type: 'string' }, description: 'task KIỂM THỬ Đội 1 yêu cầu (deny-path/contract/integration) — Đội 2 viết, Đội 3 verify' },
    reused: { type: 'boolean', description: 'true nếu tái dùng NGUYÊN micro-plan đã lưu (không cần ghi lại); false nếu phân rã mới/cập nhật → sẽ LƯU' },
    reconcileNotes: { type: 'string', description: 'prose gap-analysis/invariants/verify/gate/out-of-scope — để PERSIST vào docs/plans/<id>.md cho lần sau' },
    reason: { type: 'string' },
  },
};
const PLAN_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict'],
  properties: { verdict: { type: 'string', enum: ['PASS', 'BLOCK'] }, issues: { type: 'array', items: { type: 'string' } } },
};
const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lane', 'status', 'summary'],
  properties: {
    lane: { type: 'string' },
    status: { type: 'string', enum: ['committed', 'needs_human', 'dropped'] },
    summary: { type: 'string' },
    commit: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
};
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    checksPassed: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' }, description: 'gì KHÔNG đạt — trả về Đội 1 để tìm hướng xử lý' },
    score: { type: 'number' },
    note: { type: 'string' },
  },
};
const REANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fixLanes'],
  properties: {
    fixLanes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'task', 'builder'],
        properties: {
          id: { type: 'string' },
          task: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          builder: { type: 'string', enum: ['backend-builder', 'frontend-builder', 'db-migration'] },
        },
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
};
const SHIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'summary'],
  properties: {
    action: { type: 'string', enum: ['merged', 'pr_opened', 'blocked_protection', 'committed', 'stopped'] },
    branch: { type: 'string' },
    pr: { type: 'string' },
    summary: { type: 'string' },
  },
};
const STAMP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' }, ts: { type: 'string' } },
};

// ─────────────────────────── Prompts ──────────────────────────────────────
const J = (o) => JSON.stringify(o);

// ── ĐỘI 1: Phân tích & Kế hoạch ──
const analyzePrompt = (exclude) =>
  [
    `Bạn là ĐỘI 1 (Phân tích & Kế hoạch) của MediaOS — tech-lead + project-analyst.`,
    `MỤC TIÊU: tìm 1 Work Order READY kế tiếp rồi PHÂN RÃ thành bước nhỏ để Đội 2 thực thi và Đội 3 nghiệm thu.`,
    `Đọc harness/backlog.mjs. READY = status 'todo' && mọi depends_on đã 'done'.`,
    only ? `CHỈ XÉT Work Order id khớp regex /${only}/ — bỏ qua mọi WO khác. Hết WO khớp READY → { done:true }.` : '',
    `LOẠI các id đang in-flight/đã giao người: ${exclude.length ? exclude.join(', ') : '(không)'}.`,
    `Ưu tiên: ít phụ thuộc & mở khóa nhiều việc khác trước.`,
    `Nếu KHÔNG còn READY actionable → trả { done:true }.`,
    `Nếu có → XÁC ĐỊNH ĐÚNG TÀI LIỆU LIÊN QUAN trước (KHÔNG chỉ đọc docs/spec/):`,
    `  • Mở docs/README.md (chỉ mục trung tâm) → §8 "Bản đồ ghép cặp theo module" để tìm bộ doc cho domain/module của WO, đọc CHÉO nhiều nhóm:`,
    `    SPEC (rule nghiệp vụ) · DB-* (schema/constraint) · API-* (endpoint/contract) · BACKEND-*/FRONTEND-* (chi tiết triển khai) · QA-* (test case).`,
    `  • BẮT BUỘC đọc docs/DECISIONS/DECISIONS-02 (khóa stack + 3 bất biến) trước khi lập kế hoạch.`,
    `  • THEO trích dẫn §mục trong done_when của WO (vd "DB-08 §8.5", "BACKEND-04 §18.2", "BACKEND-11 §13.3") — mở đúng file/section đó, KHÔNG đoán.`,
    `Rồi trả:`,
    `  - workOrder {id,title,paths}`,
    `  - lanes[]: phân rã thành lane KHÔNG chồng paths, builder theo DOMAIN (db/migration→db-migration · FE/.tsx→frontend-builder · còn lại→backend-builder). KHÔNG gán "màu/zone".`,
    `  - steps[]: các bước thực thi tối thiểu.`,
    `  - acceptanceChecks[]: TIÊU CHÍ NGHIỆM THU ĐO ĐƯỢC để Đội 3 đối chiếu (bám done_when của WO + §mục doc đã trích + Definition of Done CLAUDE.md §8).`,
    `  - testTasks[]: TASK KIỂM THỬ bắt buộc, LẤY TỪ bộ QA-* khớp module (QA-02 test-case matrix · QA-04 API/contract · QA-05 permission/role/data-scope · QA-06 security) + deny-path RED-trước cho permission/workflow, integration trên DB cô lập — Đội 2 PHẢI viết, Đội 3 verify.`,
    `Migration nếu cần PHẢI là lane builder='db-migration' (chạy nối tiếp trước). Bất biến CLAUDE.md §2 luôn áp dụng (RLS+FORCE trước backfill · audit append-only · không secret plaintext).`,
    `Trả DUY NHẤT object theo schema.`,
  ]
    .filter(Boolean)
    .join('\n');

// ĐỘI 1 — phân rã 1 WO ĐÃ CHỌN (KHÔNG tìm next). Dùng khi triage quyết định việc KHÓ cần kế hoạch.
// Đường dẫn micro-plan của 1 WO: con trỏ `plan` tường minh > mặc định docs/plans/<id>.md.
const planPathFor = (wo) => wo.plan || `docs/plans/${wo.id}.md`;

const decomposePrompt = (wo, planPath) =>
  [
    `Bạn là ĐỘI 1 (Phân tích & Kế hoạch) của MediaOS — tech-lead. PHÂN RÃ Work Order ĐÃ CHỌN dưới đây (KHÔNG tìm WO khác).`,
    `Work Order: ${J({ id: wo.id, title: wo.title, zone: wo.zone, paths: wo.paths, done_when: wo.done_when })}.`,
    planPath
      ? `♻️ TÁI DÙNG TRƯỚC — Read "${planPath}". NẾU có khối \`\`\`yaml máy-đọc (lanes/acceptanceChecks/testTasks/steps): RECONCILE-REFRESH — đối chiếu LẠI từng acceptance/gap với CODE HIỆN TẠI (Grep/Read). Vẫn đúng → trả NGUYÊN lanes/acceptanceChecks/testTasks/steps đó + reused=true. Code đã đổi (gap đóng/khác) → cập nhật + reused=false. File không tồn tại / không có khối yaml → phân rã MỚI (reused=false).`
      : '',
    `KHI PHÂN RÃ MỚI — XÁC ĐỊNH ĐÚNG TÀI LIỆU (KHÔNG chỉ đọc docs/spec/):`,
    `  • docs/README.md §8 (bản đồ ghép cặp) → bộ doc cho module; đọc CHÉO SPEC · DB-* · API-* · BACKEND-*/FRONTEND-* · QA-*.`,
    `  • BẮT BUỘC đọc docs/DECISIONS/DECISIONS-02 (khóa stack + 3 bất biến).`,
    `  • THEO trích dẫn §mục trong done_when/src — mở đúng file/section, KHÔNG đoán.`,
    `Trả:`,
    `  - workOrder {id,title,paths} (GIỮ đúng id đã cho).`,
    `  - lanes[]: lane KHÔNG chồng paths, builder theo DOMAIN (db/migration→db-migration · FE/.tsx→frontend-builder · còn lại→backend-builder).`,
    `  - steps[] · acceptanceChecks[] (đo được, bám done_when+§doc+DoD §8) · testTasks[] (QA-* + deny-path RED cho permission/workflow, integration DB cô lập).`,
    `  - reconcileNotes: prose gap-analysis/invariants/verify/gate/out-of-scope (để LƯU lại tái dùng).`,
    `  - reused: true nếu tái dùng nguyên plan cũ; false nếu mới/cập nhật.`,
    `Migration nếu cần PHẢI là lane builder='db-migration' (nối tiếp trước). Bất biến CLAUDE.md §2 luôn áp dụng. Trả DUY NHẤT object theo schema, done=false.`,
  ]
    .filter(Boolean)
    .join('\n');

// Ghi micro-plan ra file để TÁI DÙNG (project-analyst — chỉ ghi docs, KHÔNG đụng code).
const persistPlanPrompt = (wo, planPath, plan) =>
  [
    `Bạn là project-analyst. GHI micro-plan của Work Order ${wo.id} ra "${planPath}" (tạo thư mục cha nếu cần, GHI ĐÈ nếu đã có) để auto-loop ĐỌC LẠI lần sau.`,
    `Định dạng: MỘT khối \`\`\`yaml máy-đọc, RỒI tới prose. Khối yaml (đúng key, JSON-flow hợp lệ YAML):`,
    `  wo: ${wo.id}`,
    `  zone: ${wo.zone || ''}`,
    `  generated_by: auto-loop`,
    `  reconciled_at: "<chạy 'git rev-parse --short HEAD' điền sha hiện tại — mốc freshness>"`,
    `  lanes: ${J(plan.lanes || [])}`,
    `  acceptanceChecks: ${J(plan.acceptanceChecks || [])}`,
    `  testTasks: ${J(plan.testTasks || [])}`,
    `  steps: ${J(plan.steps || [])}`,
    `Dưới khối yaml, ghi prose reconcile (gap-analysis/invariants/verify/gate/out-of-scope):`,
    plan.reconcileNotes || '(tóm tắt ngắn từ lanes/steps)',
    `Trả { ok:true } theo schema. CHỈ ghi file plan này, KHÔNG đụng code/khác.`,
  ].join('\n');

const planReviewPrompt = (wo, lanes, steps, accept, tests) =>
  [
    `Bạn là plan-reviewer. Duyệt kế hoạch của Đội 1 cho Work Order ${wo.id} TRƯỚC khi Đội 2 code.`,
    `lanes: ${J(lanes)} · steps: ${J(steps)} · acceptanceChecks: ${J(accept)} · testTasks: ${J(tests)}.`,
    `Tìm: thiếu phụ thuộc, rủi ro bất biến/bảo mật, thứ tự migration không an toàn, thiếu deny-path test cho việc nhạy cảm, scope creep, nghiệm thu không đo được.`,
    `BLOCK nếu việc nhạy cảm mà THIẾU deny-path test trong testTasks, hoặc nghiệm thu mơ hồ. Ngược lại PASS.`,
    `Trả { verdict(PASS|BLOCK), issues[] } theo schema.`,
  ].join('\n');

// ── ĐỘI 2: Thực thi ──
// Worktree preamble (chế độ song song): mỗi WO làm trong worktree riêng off MERGE_BASE, cô lập git index.
const wtPreamble = (wo, wt) =>
  wt
    ? [
        `🌳 LÀM TRONG WORKTREE RIÊNG (song song, cô lập khỏi cây gốc + worktree WO khác): ${wt}`,
        `   Bước 0 — tạo nếu chưa có rồi VÀO: git worktree add -B auto/${wo.id} "${wt}" ${MERGE_BASE} 2>/dev/null || true ; cd "${wt}"`,
        `   MỌI lệnh git/pnpm/test chạy với: cd "${wt}" && <lệnh>. TUYỆT ĐỐI KHÔNG đụng cây gốc hay worktree WO khác.`,
      ].join('\n')
    : '';

const buildPrompt = (wo, lane, ctx, attempt, wt) =>
  [
    `Bạn là ĐỘI 2 (Thực thi). LANE ${lane.id} của Work Order ${wo.id}. NHIỆM VỤ: ${lane.task}`,
    wtPreamble(wo, wt),
    `Bước: ${J(ctx.steps || [])}. Task kiểm thử BẮT BUỘC viết: ${J(ctx.tests || [])}. Nghiệm thu Đội 3 sẽ đối chiếu: ${J(ctx.accept || [])}.`,
    ctx.fix && ctx.fix.length ? `⚠️ ĐÂY LÀ VÒNG SỬA. Đội 3 đã FAIL các điểm: ${J(ctx.fix)}. Xử lý ĐÚNG các điểm này, đừng làm lệch.` : '',
    attempt > 1 ? `⚠️ Lần thử ${attempt} (lần trước kẹt build) — truy ROOT-CAUSE, đừng lặp lỗi cũ.` : '',
    `VÒNG: (1) viết test (deny-path/contract) RED trước cho việc nhạy cảm → (2) implement TỐI THIỂU GREEN → (3) gate + typecheck + test;`,
    `   AUTO BUILD-FIX nếu đỏ (root-cause hoặc build-resolver) — CẤM @ts-ignore/eslint-disable/catch rỗng.`,
    `(4) Nếu XANH → STAGE CHỈ file bạn vừa tạo/sửa TRONG paths của lane (liệt kê tường minh: git add <path1> <path2> … — phạm vi cho phép: ${J(lane.paths || [])}). ⛔ TUYỆT ĐỐI KHÔNG 'git add -A' / 'git add .' / 'git add :/' — cây làm việc đang có thay đổi KHÔNG liên quan, CẤM gom vào commit của WO. Rồi git commit -m "wip(${lane.id}): <mô tả>" → status=committed + commit sha. (Kiểm 'git status' trước commit: nếu có file ngoài paths bị stage → unstage nó.)`,
    `   Nếu kẹt build không tự sửa được → status=needs_human + blockers cụ thể.`,
    `BẤT BIẾN (luôn, do hook ép): company_id mọi query · RLS+FORCE TRƯỚC backfill · audit append-only (UNION/ON CONFLICT, KHÔNG rewrite CHECK) · không secret plaintext.`,
    `Hot-file APPEND, KHÔNG rewrite. Trả DUY NHẤT object theo schema (lane="${lane.id}").`,
  ]
    .filter(Boolean)
    .join('\n');

// ── ĐỘI 3: Kiểm tra & Review ──
const reviewPrompt = (wo, built, accept, tests, role, wt) =>
  [
    `Bạn là ĐỘI 3 (Kiểm tra & Review) — vai ${role}. Đối chiếu kết quả Đội 2 với YÊU CẦU Đội 1 đặt ra cho Work Order ${wo.id}.`,
    wt ? `🌳 Thay đổi nằm trong WORKTREE: xem diff bằng 'cd "${wt}" && git --no-pager diff ${MERGE_BASE}..HEAD'; chạy test bằng 'cd "${wt}" && <lệnh test>'. KHÔNG xem cây gốc.` : '',
    `Lane đã commit: ${J(built.map((b) => ({ lane: b.lane, commit: b.commit })))}.`,
    `TIÊU CHÍ NGHIỆM THU (phải đạt HẾT): ${J(accept)}.`,
    `TASK KIỂM THỬ phải tồn tại + xanh: ${J(tests)}.`,
    role === 'completion-evaluator'
      ? `Chấm Definition of Done + rubric, đối chiếu §mục doc liên quan (docs/README.md §8 map ra DB-*/BACKEND-*/API-* khớp module). Chạy test/lint LẤY BẰNG CHỨNG. FAIL nếu thiếu acceptanceCheck nào, thiếu deny-path test vùng nhạy cảm, vi phạm bất biến, hoặc vá triệu chứng.`
      : role === 'qa-test-engineer'
        ? `Kiểm test THẬT đối chiếu bộ QA-* khớp module (QA-02 case matrix · QA-05 permission/data-scope · QA-06 security): deny-path RED-trước có chạy không, coverage vùng nhạy cảm, integration trên DB cô lập. FAIL nếu test giả/thiếu/đỏ/không phủ case QA bắt buộc.`
        : `Review độc lập theo OWASP + 3 bất biến (permission/RLS/secret/audit/auth/migration), tham chiếu QA-06 + docs/DECISIONS/. FAIL nếu có lỗ hổng CRITICAL/HIGH.`,
    `Trả { verdict(PASS|FAIL), checksPassed[], failures[], score, note } — failures là danh sách điểm KHÔNG đạt để trả Đội 1.`,
  ].join('\n');

const reanalyzePrompt = (wo, failures) =>
  [
    `Bạn là ĐỘI 1 (Phân tích & Kế hoạch). Đội 3 đã TRẢ LẠI Work Order ${wo.id} vì KHÔNG đạt:`,
    `${J(failures)}.`,
    `Phân tích nguyên nhân gốc rồi TẠO TASK SỬA: trả fixLanes[] (lane sửa, builder theo domain) + steps[] cụ thể để Đội 2 xử lý đúng các điểm fail.`,
    `KHÔNG mở rộng scope ngoài WO. Trả { fixLanes[], steps[], reason } theo schema.`,
  ].join('\n');

// ── ĐỘI 3 → SHIP (lights-out auto-merge, degrade trung thực) ──
const shipPrompt = (wo, sensitive, wt) =>
  [
    `Bạn là deploy-gate. Work Order ${wo.id} đã được Đội 3 duyệt PASS. ĐÁNH DẤU HOÀN THÀNH + đưa ra master theo lights-out.`,
    `LUẬT (harness/policy.md): KHÔNG push thẳng master.`,
    wt
      ? `🌳 WO này làm trong WORKTREE ${wt}, các commit đã nằm trên branch 'auto/${wo.id}'. Chạy git/gh với 'cd "${wt}" && …': push branch 'auto/${wo.id}', 'gh pr create' base=${MERGE_BASE} head=auto/${wo.id}.${KEEP_WORKTREE ? '' : ` SAU KHI merge/PR xong: 'cd <repo gốc> && git worktree remove "${wt}" --force' để dọn.`} KHÔNG 'git add -A'.`
      : `⛔ CÂY LÀM VIỆC ĐANG BẨN (có thay đổi KHÔNG liên quan WO). TUYỆT ĐỐI KHÔNG 'git add -A'/'git add .'. Commit của WO đã do Đội 2 tạo sẵn (chỉ file trong paths: ${J(wo.paths || [])}). Tạo branch từ các COMMIT đã có (branch KHÔNG mang theo file chưa stage). Nếu cần commit thêm, stage CHỈ file trong paths của WO. KHÔNG để file ngoài paths lọt vào PR.`,
    AUTO_MERGE
      ? [
          `CHẾ ĐỘ AUTO-MERGE (lights-out): tạo branch auto/${wo.id} (từ ${MERGE_BASE} hoặc HEAD hiện tại), commit gộp, push, 'gh pr create' base=${MERGE_BASE}.`,
          `Cố auto-merge: gắn nhãn 'auto-merge' + 'gh pr merge --squash --auto'.`,
          `⚠️ NẾU branch protection của base yêu cầu review NGƯỜI (gh báo chặn) → KHÔNG ép. Để PR + nhãn auto-merge, action=blocked_protection, summary nêu rõ "GitHub chặn auto-merge: cần 1 review người" (KHÔNG báo merged khi chưa merge).`,
          `Nếu base KHÔNG protection / đủ điều kiện → squash-merge xong → action=merged + pr.`,
        ].join('\n')
      : `CHẾ ĐỘ PR: tạo branch auto/${wo.id}, commit gộp, push, 'gh pr create' + nhãn 'auto-merge' (chờ người). action=pr_opened.`,
    sensitive ? `Lane nhạy cảm — đảm bảo FULL gate đã PASS ở Đội 3 trước khi mở PR.` : '',
    `Nếu thiếu gh/remote → action=committed (chỉ commit local), nêu rõ trong summary.`,
    `Trả { action, branch, pr, summary } theo schema.`,
  ]
    .filter(Boolean)
    .join('\n');

const stampCmd = (wo, phase, detail) =>
  phase === 'started'
    ? `LEDGER_BY=auto-loop node harness/ledger.mjs start ${wo} "${detail || ''}"`
    : phase === 'finished'
      ? `LEDGER_BY=auto-loop node harness/ledger.mjs done ${wo} "${detail || ''}"`
      : `LEDGER_BY=auto-loop node harness/ledger.mjs event ${wo} ${phase} "${detail || ''}"`;

// Trợ lý đóng dấu thời gian — live-only, best-effort (chỉ start + finish; bỏ milestone để đỡ tốn agent).
const stamp = async (wo, phase, detail) => {
  if (dryRun) return;
  try {
    await agent(
      [`Đóng dấu MỐC tiến độ vào sổ hoạt động. Chạy ĐÚNG 1 lệnh:`, stampCmd(wo, phase, detail), `Trả { ok:true, ts }. KHÔNG làm gì khác.`].join('\n'),
      { agentType: 'progress-tracker', effort: 'low', schema: STAMP_SCHEMA, label: `track:${phase}:${wo}`, phase: 'Build' },
    );
  } catch {
    /* ghi sổ là phụ — không để hỏng sổ chặn vòng chính */
  }
};

// ─────────────────────────── Vòng lặp 3 đội ───────────────────────────────
const skip = new Set(); // WO bỏ qua lượt này (giao người / vắt kiệt vòng phản hồi)
const inFlight = []; // WO đã ship (merged/PR) — không pick lại
const report = [];
const dryQueue = [];
let queue = providedWOs ? [...providedWOs] : null; // hàng đợi READY (nếu truyền qua args)
let round = 0;

// ── planWO: TRIAGE 1 queue item → {wo,lanes,accept,tests,steps,sensitive,planned}. Đội 1 chỉ chạy khi việc KHÓ + LIVE. ──
async function planWO(item) {
  const wo = { id: item.id, title: item.title, paths: item.paths || [], zone: item.zone, plan: item.plan };
  const planned = needsPlanning(item);
  let lanes, accept, tests, steps;
  if (planned && !dryRun) {
    phase('Analyze');
    const planPath = planPathFor(item); // đọc plan đã lưu nếu có (reconcile-refresh), chưa có → phân rã mới
    const plan = await agent(decomposePrompt(item, planPath), { agentType: 'tech-lead', schema: ANALYZE_SCHEMA, label: `analyze:${item.id}`, phase: 'Analyze' });
    lanes = plan && plan.lanes && plan.lanes.length ? plan.lanes : [{ id: wo.id, task: wo.title, paths: wo.paths, builder: domainOf(wo.paths) }];
    accept = (plan && plan.acceptanceChecks) || item.done_when || [];
    tests = (plan && plan.testTasks) || [];
    steps = (plan && plan.steps) || [];
    // TẠO-RỒI-LƯU: phân rã MỚI (không tái dùng cache) → ghi micro-plan ra file cho lần sau (best-effort).
    if (plan && plan.reused !== true && lanes.length) {
      try {
        await agent(persistPlanPrompt(wo, planPath, plan), { agentType: 'project-analyst', effort: 'low', schema: STAMP_SCHEMA, label: `plan:save:${item.id}`, phase: 'Analyze' });
      } catch {
        /* lưu plan là phụ — không để hỏng việc chính */
      }
    }
  } else {
    lanes = [{ id: wo.id, task: wo.title, paths: wo.paths, builder: domainOf(wo.paths) }];
    accept = item.done_when || [];
    tests = [];
    steps = [];
  }
  return { wo, lanes, accept, tests, steps, sensitive: lanes.some(isSensitive), planned };
}

// ── dryRun preview cho 1 WO (KHÔNG gọi agent, KHÔNG chạm hệ thống) ──
function dryPreview(plan) {
  const { wo, lanes, accept, tests, planned } = plan;
  dryQueue.push({
    wo: wo.id,
    mode: planned ? '🧠 Đội1 phân rã' : '⚡ build THẲNG (skip Đội1)',
    lanes: lanes.map((l) => `${l.id}→${l.builder}${isSensitive(l) ? '(nhạy cảm→Opus+security)' : ''}`),
    acceptanceChecks: accept.length,
    testTasks: tests.length,
    ship: AUTO_MERGE ? `auto-merge→${MERGE_BASE}` : 'PR (chờ người)',
  });
  skip.add(wo.id);
  log(`🔎 [dry] ${wo.id}: ${planned ? '🧠 Đội1' : '⚡ THẲNG'} · ${lanes.length} lane · ${accept.length} nghiệm thu · ${tests.length} test → Đội2 → Đội3 → ${AUTO_MERGE ? 'auto-merge' : 'PR'}`);
}

// ── Ship MUTEX: ở chế độ song song, merge XẾP TUẦN TỰ (tránh đua ref khi nhiều PR cùng base). ──
let shipChain = Promise.resolve();
const shipSerialized = (fn) => {
  const run = shipChain.then(fn, fn);
  shipChain = run.then(() => {}, () => {});
  return run;
};

// ── executeWO: build⇄review (≤MAX_REVIEW) → ship. wt = worktree (song song) | null (tuần tự, cây gốc). Mutate report/inFlight/skip; KHÔNG ném. ──
async function executeWO(plan, wt) {
  let { wo, lanes, accept, tests, steps, sensitive } = plan;

  // mốc BẮT ĐẦU
  await stamp(wo.id, 'started', `${lanes.length} lane (${lanes.map((l) => l.builder).join(',')})${sensitive ? ' · nhạy cảm' : ''}${wt ? ' · wt' : ''}`);

  // ── plan-reviewer (chỉ lane nhạy cảm — gác deny-path + nghiệm thu đo được) ──
  if (sensitive) {
    phase('PlanReview');
    const pr = await agent(planReviewPrompt(wo, lanes, steps, accept, tests), { agentType: 'plan-reviewer', schema: PLAN_REVIEW_SCHEMA, label: `planreview:${wo.id}`, phase: 'PlanReview' });
    if (pr && pr.verdict === 'BLOCK') {
      skip.add(wo.id);
      await stamp(wo.id, 'finished', `plan_block: ${(pr.issues || []).join('; ')}`);
      report.push({ wo: wo.id, outcome: 'needs_human', detail: `Đội 1 plan BLOCK bởi plan-reviewer: ${(pr.issues || []).join(' · ') || 'n/a'}` });
      log(`⛔ ${wo.id} kế hoạch BLOCK → người.`);
      return;
    }
  }

  // ── Vòng phản hồi Đội2 ⇄ Đội3, tối đa MAX_REVIEW ──
  let shipped = false;
  let lastFailures = [];
  let fixContext = [];
  for (let iter = 1; iter <= MAX_REVIEW; iter++) {
    // ── ĐỘI 2: Thực thi (migration nối tiếp TRƯỚC; tuần tự cùng cây tránh đụng hot-file) ──
    phase('Build');
    const ordered = [...lanes.filter((l) => l.builder === 'db-migration'), ...lanes.filter((l) => l.builder !== 'db-migration')];
    const buildLane = async (lane) => {
      const ctx = { steps, tests, accept, fix: fixContext };
      for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        const r = await agent(buildPrompt(wo, lane, ctx, attempt, wt), {
          agentType: lane.builder,
          model: isSensitive(lane) ? 'opus' : undefined,
          effort: attempt > 1 ? 'high' : undefined,
          schema: IMPL_SCHEMA,
          label: `build:${lane.id}#i${iter}.${attempt}`,
          phase: 'Build',
        });
        if (r && (r.status === 'committed' || r.status === 'needs_human')) return r;
        log(`↻ ${lane.id} i${iter}.${attempt} = ${r ? r.status : 'null'} → ${attempt < MAX_RETRY ? 'retry' : 'bỏ cuộc'}`);
      }
      return { lane: lane.id, status: 'dropped', summary: `Bỏ cuộc sau ${MAX_RETRY} lần`, blockers: ['retry exhausted'] };
    };
    const built = [];
    for (const lane of ordered) built.push(await buildLane(lane));
    const stuck = built.filter((b) => !b || b.status !== 'committed');
    if (stuck.length) {
      skip.add(wo.id);
      await stamp(wo.id, 'finished', `needs_human: build kẹt (${stuck.map((s) => `${s.lane}:${s && s.status}`).join(', ')})`);
      report.push({ wo: wo.id, outcome: 'needs_human', detail: `Build kẹt vòng ${iter}: ${stuck.map((s) => `${s.lane}(${s && s.status})`).join(', ')} · ${stuck.flatMap((s) => (s && s.blockers) || []).join(' · ')}` });
      log(`🛑 ${wo.id} build kẹt → người. Tiếp READY kế.`);
      break;
    }

    // ── ĐỘI 3: Kiểm tra & Review (song song; PASS iff TẤT CẢ pass) ──
    phase('Review');
    const roles = sensitive ? ['completion-evaluator', 'security-reviewer', 'qa-test-engineer'] : ['completion-evaluator', 'code-reviewer'];
    const reviews = await parallel(
      roles.map((role) => () =>
        agent(reviewPrompt(wo, built, accept, tests, role, wt), {
          agentType: role,
          schema: REVIEW_SCHEMA,
          label: `review:${role}:${wo.id}#i${iter}`,
          phase: 'Review',
        }),
      ),
    );
    const valid = reviews.filter(Boolean);
    const passed = valid.length > 0 && valid.every((r) => r.verdict === 'PASS');
    lastFailures = valid.flatMap((r) => r.failures || []);

    if (passed) {
      shipped = true;
      const score = valid.map((r) => (typeof r.score === 'number' ? r.score : null)).filter((s) => s != null);
      await stamp(wo.id, 'milestone', `Đội3 PASS (vòng ${iter})${score.length ? ' score~' + Math.min(...score) : ''}`);
      break;
    }

    // FAIL → Đội 1 re-analyze (trừ khi đã hết vòng)
    log(`↩ ${wo.id} Đội3 FAIL vòng ${iter}/${MAX_REVIEW}: ${lastFailures.slice(0, 3).join(' · ') || 'n/a'}`);
    if (iter < MAX_REVIEW) {
      phase('Re-analyze');
      const re = await agent(reanalyzePrompt(wo, lastFailures), { agentType: 'tech-lead', schema: REANALYZE_SCHEMA, label: `reanalyze:${wo.id}#i${iter}`, phase: 'Re-analyze' });
      if (re && re.fixLanes && re.fixLanes.length) {
        lanes = re.fixLanes;
        fixContext = lastFailures;
      } else {
        fixContext = lastFailures; // không có fixLane → để Đội 2 tự xử theo failures trên lanes cũ
      }
    }
  }

  // ── Kết cục WO ──
  if (!shipped) {
    if (!skip.has(wo.id)) {
      // hết vòng phản hồi mà chưa PASS
      skip.add(wo.id);
      await stamp(wo.id, 'finished', `needs_human: review FAIL sau ${MAX_REVIEW} vòng`);
      report.push({ wo: wo.id, outcome: 'needs_human', detail: `Đội 3 vẫn FAIL sau ${MAX_REVIEW} vòng phản hồi. Tồn đọng: ${lastFailures.join(' · ') || 'n/a'}` });
      log(`⛔ ${wo.id} review FAIL ${MAX_REVIEW} vòng → người.`);
    }
    return;
  }

  // ── SHIP: đánh dấu hoàn thành (merge XẾP TUẦN TỰ qua mutex — kể cả ở chế độ song song) ──
  phase('Ship');
  const dep = await shipSerialized(() => agent(shipPrompt(wo, sensitive, wt), { agentType: 'deploy-gate', schema: SHIP_SCHEMA, label: `ship:${wo.id}`, phase: 'Ship' }));
  if (dep && ['merged', 'pr_opened', 'blocked_protection', 'committed'].includes(dep.action)) {
    inFlight.push({ id: wo.id, action: dep.action, pr: dep.pr, branch: dep.branch });
    await stamp(wo.id, 'finished', `${dep.action}${dep.pr ? ' ' + dep.pr : ''}${dep.branch ? ' (' + dep.branch + ')' : ''}`);
    const tail = dep.action === 'merged' ? 'ĐÃ auto-merge.' : dep.action === 'blocked_protection' ? 'branch protection chặn — chờ 1 review NGƯỜI rồi auto-merge.' : dep.action === 'pr_opened' ? 'PR mở — chờ người duyệt.' : 'commit local (thiếu gh/remote).';
    report.push({ wo: wo.id, outcome: dep.action, detail: `${dep.summary} — ${tail}` });
    log(`📤 ${wo.id} → ${dep.action}: ${dep.pr || dep.branch || ''} (${tail})`);
  } else {
    skip.add(wo.id);
    await stamp(wo.id, 'finished', (dep && dep.action) || 'stopped');
    report.push({ wo: wo.id, outcome: (dep && dep.action) || 'stopped', detail: (dep && dep.summary) || 'ship dừng' });
    log(`🛑 ${wo.id} ship dừng (${dep && dep.action}).`);
  }
}

// ══════════════ ĐIỀU PHỐI: tuần tự (mặc định) | song song (maxConcurrent>1) ══════════════
if (dryRun && queue && MAX_CONCURRENT > 1) {
  scheduleWaves(queue, MAX_CONCURRENT).forEach((w, i) => log(`🗓️ [dry] Wave ${i + 1} (song song): ${w.map((x) => x.id).join(', ')}`));
}

if (queue && MAX_CONCURRENT > 1 && !dryRun) {
  // ── SONG SONG: scheduler ĐỘNG — khởi WO không-xung-đột ngay khi có slot (tối đa MAX_CONCURRENT) ──
  log(`▶ SONG SONG: tối đa ${MAX_CONCURRENT} WO đồng thời · xung đột paths/migration → tuần tự · mỗi WO 1 worktree off ${MERGE_BASE}.`);
  const pending = [...queue];
  const running = []; // item đang chạy (để kiểm xung đột)
  const inflight = new Set();
  const startable = (it) => !running.some((r) => conflict(r, it));
  while (pending.length || inflight.size) {
    const lowBudget = budget.total && budget.remaining() < MIN_BUDGET;
    while (!lowBudget && inflight.size < MAX_CONCURRENT) {
      const i = pending.findIndex(startable);
      if (i === -1) break;
      const it = pending.splice(i, 1)[0];
      running.push(it);
      round++;
      const wt = worktreePath(it.id);
      const p = (async () => executeWO(await planWO(it), wt))()
        .catch((e) => {
          report.push({ wo: it.id, outcome: 'stopped', detail: `lỗi xử lý song song: ${(e && e.message) || e}` });
          log(`🛑 ${it.id} lỗi song song: ${(e && e.message) || e}`);
        })
        .finally(() => {
          const k = running.indexOf(it);
          if (k >= 0) running.splice(k, 1);
          inflight.delete(p);
        });
      inflight.add(p);
    }
    if (inflight.size) await Promise.race(inflight);
    else break; // không khởi động được thêm (hết slot/cạn budget) và không có gì đang chạy
  }
  if (pending.length) log(`⏸ Còn ${pending.length} WO chưa chạy (cạn budget/dừng): ${pending.map((x) => x.id).join(', ')}`);
} else {
  // ── TUẦN TỰ (mặc định) + DRYRUN + FALLBACK (Đội 1 tự tìm) ──
  while (round < MAX_ROUNDS) {
    if (budget.total && budget.remaining() < MIN_BUDGET) {
      log(`⛔ Cạn budget (còn ${Math.round(budget.remaining() / 1000)}k) — dừng-có-trạng-thái.`);
      break;
    }
    round++;
    if (queue) {
      if (!queue.length) {
        log(`✅ Hết WO trong hàng đợi (round ${round}). Dừng vòng.`);
        break;
      }
      const plan = await planWO(queue.shift());
      if (dryRun) {
        dryPreview(plan);
        continue;
      }
      await executeWO(plan, null);
    } else {
      // FALLBACK: Đội 1 TỰ tìm next READY (hành vi cũ) — luôn tuần tự.
      phase('Analyze');
      const exclude = [...skip, ...inFlight.map((x) => x.id)];
      const fp = await agent(analyzePrompt(exclude), { agentType: 'tech-lead', schema: ANALYZE_SCHEMA, label: `analyze:r${round}`, phase: 'Analyze' });
      if (!fp || fp.done || !fp.workOrder) {
        log(`✅ Hết Work Order READY actionable (round ${round}). Dừng vòng.`);
        break;
      }
      const wo = fp.workOrder;
      const lanes = fp.lanes && fp.lanes.length ? fp.lanes : [{ id: wo.id, task: wo.title, paths: wo.paths, builder: domainOf(wo.paths) }];
      const plan = { wo, lanes, accept: fp.acceptanceChecks || [], tests: fp.testTasks || [], steps: fp.steps || [], sensitive: lanes.some(isSensitive), planned: true };
      if (dryRun) {
        dryPreview(plan);
        continue;
      }
      await executeWO(plan, null);
    }
  }
}

// ─────────────────────────── Tổng kết (dừng-có-trạng-thái) ─────────────────
const needsHuman = report.filter((r) => ['needs_human', 'stopped'].includes(r.outcome));
const merged = report.filter((r) => r.outcome === 'merged');
const waitingHuman = report.filter((r) => ['pr_opened', 'blocked_protection'].includes(r.outcome));
log(`═══ AUTO-LOOP (3 đội) xong: ${round} round · ${dryRun ? 'DRYRUN' : 'LIVE'} · merged ${merged.length} · chờ-người-merge ${waitingHuman.length} · giao-người ${needsHuman.length} ═══`);
return {
  model: 'Đội1 Phân tích/Kế hoạch → Đội2 Thực thi → Đội3 Kiểm tra/Review (PASS→ship · FAIL→Đội1 re-analyze), KHÔNG chia màu',
  mode: dryRun ? 'dryRun (không mutate)' : AUTO_MERGE ? `live + lights-out (auto-merge→${MERGE_BASE})` : 'live (PR, chờ người)',
  rounds: round,
  dryQueue: dryRun ? dryQueue : undefined,
  merged, // WO ĐÃ auto-merge
  waitingHuman, // WO ship nhưng branch protection cần 1 review người
  needsHuman, // WO giao người: build kẹt / review FAIL hết vòng / plan block
  inFlight,
  report,
  note: `Bất biến CLAUDE.md §2 do hook ép, KHÔNG bỏ. Lights-out merge degrade trung thực: nếu master/base protection cần review người → để PR + nhãn auto-merge (blocked_protection), không báo merged. Đổi đích: {mergeBase:'...'}; tắt lights-out: {autoMerge:false}; tăng vòng phản hồi: {maxReviewIterations:N}.`,
};
