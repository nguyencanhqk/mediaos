export const meta = {
  name: 'parallel-lanes',
  description: 'Fan-out micro-step (plan→RED→GREEN→gate→review→checkpoint) trên nhiều lane MediaOS song song, tự chọn model + agent/skill theo độ khó',
  whenToUse: 'Khi muốn đẩy nhiều phase G* cùng lúc — mỗi lane 1 worktree + 1 band migration riêng. Crown-jewel tự lên Opus + plan + review độc lập; việc thường chạy Sonnet, reviewer/skill chèn vào gate (TASKS.md §5).',
  phases: [
    { title: 'Plan', detail: 'lane crown-jewel: 1 agent Opus lập micro-plan trước khi code' },
    { title: 'Implement', detail: 'mỗi lane 1 agent trong worktree+band của nó, chạy 1 round micro-step' },
    { title: 'Review', detail: 'lane crown-jewel: spawn reviewer agent độc lập trên diff (security/database/…) + santa-method' },
  ],
};

// args = {
//   dryRun: true,            // (tuỳ chọn) chỉ in bảng routing, KHÔNG spawn agent
//   lanes: [
//     { id: 'g11', worktree: 'c:/dev 2/mediaos-g11-hr', band: '0060-0069',
//       task: 'G11-1 attendance: schema + check-in/out + RLS + deny-path test',
//       gate: 'FULL', mode: 'TDD',           // mode: 'TDD' (🛠️) | 'AI-bulk' (🤖)
//       tier: 'crown',                       // (tuỳ chọn) ép crown-jewel -> Opus + plan + review độc lập
//       model: 'sonnet',                     // (tuỳ chọn) override model tay: 'opus'|'sonnet'|'haiku'
//       skipPlan: true,                      // (tuỳ chọn) bỏ bước plan dù là crown
//       reviewers: ['ecc:database-reviewer'],// (tuỳ chọn) ép danh sách reviewer (bỏ auto-detect)
//       noReview: true },                    // (tuỳ chọn) tắt review + gate-injection
//     ...
//   ]
// }

// args có thể đến dưới dạng object đã parse HOẶC chuỗi JSON — chấp nhận cả hai.
let cfg = args;
if (typeof cfg === 'string') {
  try {
    cfg = JSON.parse(cfg);
  } catch {
    cfg = {};
  }
}
const lanes = cfg && Array.isArray(cfg.lanes) ? cfg.lanes : [];
const dryRun = !!(cfg && cfg.dryRun);
if (!lanes.length) {
  log('⚠️  Không có lane nào trong args.lanes. Truyền { lanes: [{ id, worktree, band, task, gate, mode }] } (xem TASKS.md §5).');
  return { error: 'no lanes provided' };
}

const short = (a) => String(a).replace(/^ecc:/, '');

// ── Model routing (CLAUDE.md §6) ────────────────────────────────────────────
// Quyết định 2026-06-12 (thận trọng chất lượng): KHÔNG Haiku · Sonnet mặc định · Opus chỉ crown-jewel.
// Crown-jewel còn được lập micro-plan (Opus) TRƯỚC khi code. Việc thường chạy thẳng Sonnet.
// Không dùng \b (word-boundary ASCII không đáng tin với dấu tiếng Việt: "lương", "phê duyệt"…).
// Chấp nhận over-match nhẹ → thiên về Opus, đúng tinh thần thận trọng chất lượng.
// De-media-fy 2026-06-20: bỏ finance/revenue/cost/profit/kpi/ledger (subsystem parked). Crown MVP =
//   permission/RLS · secret/encrypt/KMS · audit/append-only · auth/token · workflow phê duyệt (FSM/DAG) · ADR.
//   Giữ cụm payroll/lương/payslip cho Phase 2 (payroll quay lại làm crown khi build).
const CROWN_JEWEL =
  /(payroll|l[uư]ơng|payslip|bảng lương|bonus|penalty|thưởng|phạt|permission|\brls\b|policy|secret|envelope|encrypt|mã hóa|kms|vault|\bauth\b|token|\bfsm\b|\bdag\b|append-only|\badr\b)/i;
const PLANNER_MODEL = 'opus'; // model cho bước plan của crown-jewel (đổi 'sonnet' nếu muốn rẻ hơn)

const isCrown = (L) => L.tier === 'crown' || CROWN_JEWEL.test(L.task || '');
const pickModel = (L) => L.model || (isCrown(L) ? 'opus' : 'sonnet');
const needsPlan = (L) => isCrown(L) && !L.skipPlan;

// ── Agent/skill routing (CLAUDE.md §6, TASKS.md §5.6) ────────────────────────
// Tự chọn reviewer/skill/build-resolver đúng domain của lane. Hybrid:
//   crown-jewel → spawn reviewer agent ĐỘC LẬP ở stage Review (+ santa-method);
//   việc thường → chèn danh sách vào prompt để implementer tự chạy.
const DOMAIN = {
  db: /(migration|drizzle|schema|\brls\b|policy|_journal|repository|withtenant|\bsql\b)/i,
  sec: /(permission|secret|envelope|encrypt|mã hóa|kms|vault|payroll|lương|payslip|audit|append-only|\bauth\b|token)/i,
  fe: /(react|\.tsx|component|\bweb\b|\bui\b|tanstack|zustand|shadcn|form|màn hình)/i,
};

// VAI TRÒ review (mô tả, để khung prompt) → agent type CÓ THẬT trong registry.
// Lý do: reviewer 'ecc:*' KHÔNG tồn tại ở runtime này → stage Review crown fail âm thầm (phiên 2026-06-20).
// 3 nhóm cho ĐA GÓC NHÌN mà không spawn trùng: DB/RLS · bảo mật · chất-lượng-code.
// Available: claude · claude-code-guide · completion-evaluator · Explore · general-purpose · Plan · plan-reviewer · rls-tenant-isolation-tester · statusline-setup.
const REVIEWER_AGENT = {
  'database-reviewer': 'rls-tenant-isolation-tester', // chuyên dụng RLS/tenant, read-only
  'security-reviewer': 'general-purpose', // suy luận bảo mật (prompt ép read-only)
  'silent-failure-hunter': 'general-purpose',
  'react-reviewer': 'completion-evaluator', // chất lượng FE/UI
  'typescript-reviewer': 'completion-evaluator', // baseline: chạy typecheck/test + rubric DoD
};
const reviewerAgentFor = (role) => REVIEWER_AGENT[short(role)] || 'general-purpose';

// Trả về [{ agentType, roles[], label }] — đã GOM theo agent thật (1 agent/lần, kèm các vai trò nó đảm nhiệm).
function pickReviewers(L) {
  if (L.noReview) return [];
  let roles;
  if (Array.isArray(L.reviewers) && L.reviewers.length) {
    roles = [...new Set(L.reviewers.map(short))]; // override: chấp nhận cả 'ecc:x' lẫn 'x'
  } else {
    const t = `${L.task || ''} ${L.gate || ''}`;
    const set = new Set();
    if (DOMAIN.db.test(t)) set.add('database-reviewer');
    if (DOMAIN.sec.test(t) || L.gate === 'FULL') {
      set.add('security-reviewer');
      set.add('silent-failure-hunter');
    }
    if (DOMAIN.fe.test(t)) set.add('react-reviewer');
    set.add('typescript-reviewer'); // baseline mọi lane có code
    roles = [...set];
  }
  const byAgent = new Map(); // agentType → roles[]
  for (const role of roles) {
    const agentType = reviewerAgentFor(role);
    if (!byAgent.has(agentType)) byAgent.set(agentType, []);
    byAgent.get(agentType).push(role);
  }
  return [...byAgent.entries()].map(([agentType, rs]) => ({ agentType, roles: rs, label: rs.join('+') }));
}

function pickSkills(L) {
  if (L.noReview) return [];
  const s = [];
  if (isCrown(L)) s.push('ecc:santa-method');
  s.push('ecc:quality-gate');
  return s;
}

const pickBuildResolver = (L) =>
  DOMAIN.fe.test(`${L.task || ''}`) ? 'ecc:react-build-resolver' : 'ecc:build-error-resolver';

// ── Log routing minh bạch ────────────────────────────────────────────────────
const routeLabel = (L) =>
  `${L.id} → ${pickModel(L)}${
    isCrown(L) ? ` [crown${needsPlan(L) ? ', +plan' : ''}${pickReviewers(L).length ? ', +review' : ''}]` : ''
  }`;

log(`Routing ${lanes.length} lane:`);
lanes.forEach((L) => {
  log(`  • ${routeLabel(L)}`);
  const rv = pickReviewers(L);
  if (rv.length) {
    const sk = pickSkills(L);
    log(`      reviewers: ${rv.map((r) => `${r.label}→${r.agentType}`).join(', ')}${sk.length ? ` · skills: ${sk.map(short).join(', ')}` : ''} · build: ${short(pickBuildResolver(L))}`);
  }
});

if (dryRun) {
  log('🔎 dryRun — chỉ in routing, không spawn agent.');
  return {
    dryRun: true,
    routing: lanes.map((L) => ({
      lane: L.id,
      model: pickModel(L),
      crown: isCrown(L),
      plan: needsPlan(L),
      reviewStage: isCrown(L) && pickReviewers(L).length > 0, // crown mới spawn reviewer độc lập
      reviewers: pickReviewers(L).map((r) => `${r.label}→${r.agentType}`),
      skills: pickSkills(L),
      buildResolver: pickBuildResolver(L),
    })),
  };
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lane', 'status', 'summary'],
  properties: {
    lane: { type: 'string' },
    status: { enum: ['committed', 'blocked', 'needs_human'] },
    summary: { type: 'string' },
    commit: { type: 'string', description: 'sha checkpoint nếu đã commit' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
};

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lane', 'steps'],
  properties: {
    lane: { type: 'string' },
    redTests: {
      type: 'array',
      items: { type: 'string' },
      description: 'deny-path/contract test RED phải viết TRƯỚC',
    },
    filesToTouch: { type: 'array', items: { type: 'string' } },
    invariants: {
      type: 'array',
      items: { type: 'string' },
      description: 'bất biến phải giữ: company_id/RLS · append-only · no secret plaintext',
    },
    migration: {
      type: 'object',
      additionalProperties: false,
      properties: {
        need: { type: 'boolean' },
        band: { type: 'string' },
      },
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'các bước implement tối thiểu để GREEN, theo thứ tự',
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reviewer', 'severity', 'blocking', 'summary'],
  properties: {
    reviewer: { type: 'string' },
    severity: { enum: ['OK', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    blocking: { type: 'boolean', description: 'true CHỈ khi lỗi CRITICAL/HIGH thật buộc người chốt' },
    findings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

function plannerPrompt(L) {
  return [
    `Bạn LẬP KẾ HOẠCH (KHÔNG sửa file) cho LANE ${L.id.toUpperCase()} — vùng CROWN-JEWEL nhạy cảm của MediaOS.`,
    `Worktree: ${L.worktree}. Band migration: ${L.band}.`,
    ``,
    `ĐỌC TRƯỚC (read-only): ${L.worktree}/CLAUDE.md (§2 bất biến · §6 review gate · §9 song song) + ${L.worktree}/TASKS.md §5.`,
    `Có thể đọc code liên quan trong ${L.worktree} để lập plan chính xác. TUYỆT ĐỐI KHÔNG Edit/Write/commit/chạy lệnh đổi trạng thái.`,
    ``,
    `NHIỆM VỤ CẦN LẬP PLAN: ${L.task}`,
    `Chế độ: ${L.mode}. Gate: ${L.gate}.`,
    ``,
    `Trả về DUY NHẤT micro-plan theo schema (lane="${L.id}"):`,
    `- redTests: deny-path/contract test RED phải viết trước (CLAUDE.md §6).`,
    `- filesToTouch: file dự kiến đụng (đúng trong worktree này).`,
    `- invariants: bất biến phải giữ — company_id ở mọi query + RLS · bảng audit/snapshot append-only · không secret plaintext.`,
    `- migration: { need, band="${L.band}" } — nếu cần migration PHẢI nằm trong band.`,
    `- steps: các bước implement TỐI THIỂU để GREEN, theo thứ tự.`,
    `- risks: rủi ro/điểm dễ sai (hot-file rewrite, rò tenant, drift DB dùng chung...).`,
  ].join('\n');
}

function implementerPrompt(L, plan) {
  const tddStep =
    L.mode === 'TDD'
      ? '1) Viết deny-path/contract test RED TRƯỚC (CLAUDE.md §6). Xác nhận test ĐỎ vì lý do đúng.'
      : '1) Bỏ qua RED riêng nếu là 🤖 CRUD thuần — nhưng vẫn phải có test cho hành vi mới.';
  const planBlock = plan
    ? [
        ``,
        `BÁM SÁT MICRO-PLAN ĐÃ DUYỆT (đừng đi chệch; nếu buộc phải lệch, nêu rõ lý do trong summary):`,
        JSON.stringify(plan, null, 2),
        ``,
      ]
    : [];
  const gateList = [...pickReviewers(L).map((r) => `${r.label} (${r.agentType})`), ...pickSkills(L).map(short)].join(', ') || '(không có)';
  const buildResolver = short(pickBuildResolver(L));
  return [
    `Bạn vận hành LANE ${L.id.toUpperCase()} của dự án MediaOS.`,
    `Worktree DUY NHẤT được phép đụng: ${L.worktree}. Band migration: ${L.band}.`,
    `Mọi lệnh git/pnpm chạy bằng: cd "${L.worktree}" && <lệnh>.`,
    ``,
    `ĐỌC TRƯỚC: ${L.worktree}/CLAUDE.md (đặc biệt §9 vận hành song song) + ${L.worktree}/TASKS.md §5.`,
    ...planBlock,
    `NHIỆM VỤ LƯỢT NÀY: ${L.task}`,
    `Chế độ: ${L.mode}. Gate: ${L.gate}.`,
    ``,
    `VÒNG MICRO-STEP BẮT BUỘC (TASKS.md §5.5):`,
    tddStep,
    `2) Implement TỐI THIỂU để GREEN. Migration (nếu có) PHẢI nằm trong band ${L.band}; _journal.json idx/when đơn điệu tăng.`,
    `2.5) DB CÔ LẬP (chống shared-DB drift) — TRƯỚC khi chạy test cần Postgres: nếu apps/api/vitest.config.ts còn bản hardcode URL cũ, đồng bộ từ master: 'git checkout master -- apps/api/vitest.config.ts'. Rồi 'bash ../MediaOS/scripts/lane-db-setup.sh ${L.id}' (tạo + chain-migrate mediaos_${L.id}) và 'export LANE_DB=mediaos_${L.id}'. TUYỆT ĐỐI KHÔNG migrate/test vào DB dùng chung 'mediaos' (drizzle migrator đơn điệu theo when → migration band thấp bị SKIP).`,
    `3) GATE LƯỢT NÀY — chạy đúng reviewer/skill sau (qua Task/skill nếu khả dụng): ${gateList}.`,
    `   Cộng 'pnpm --filter @mediaos/api typecheck' + test liên quan.`,
    `   AUTO BUILD-FIX: nếu build/typecheck ĐỎ → ưu tiên tự sửa root-cause, hoặc dùng skill '/ecc:build-fix' / agent '${buildResolver}' TRƯỚC khi báo needs_human. CẤM @ts-ignore / eslint-disable / catch rỗng.`,
    `4) Nếu XANH & không chạm vùng nhạy cảm → 'git add -A && git commit -m "wip(${L.id}): <mô tả ngắn>"' rồi báo status=committed + sha.`,
    `   Nếu ĐỎ / CRITICAL / là 🛠️ vùng nhạy cảm → DỪNG, báo status=needs_human + blockers cụ thể.`,
    ``,
    `RÀNG BUỘC CỨNG:`,
    `- TUYỆT ĐỐI chỉ làm trong ${L.worktree}; KHÔNG đụng worktree/lane khác.`,
    `- Hot-file CẤM rewrite (TASKS.md §5.3): audit object_types CHECK = UNION; permission seed = ON CONFLICT DO NOTHING; schema/index.ts + app.module.ts = khối additive.`,
    `- KHÔNG vá triệu chứng (@ts-ignore, catch rỗng, eslint-disable) — truy root-cause.`,
    ``,
    `Trả về DUY NHẤT object theo schema (lane="${L.id}").`,
  ].join('\n');
}

function reviewPrompt(L, rv) {
  const roleDesc = rv.roles.join(' + ');
  return [
    `Bạn review LANE ${L.id.toUpperCase()} của MediaOS với (các) VAI TRÒ: ${roleDesc} — vùng CROWN-JEWEL, hãy NGHIÊM KHẮC theo đúng các vai trò đó.`,
    `Worktree: ${L.worktree}. Xem thay đổi mới nhất:`,
    `  cd "${L.worktree}" && git --no-pager diff HEAD~1   (nếu lane vừa commit checkpoint)`,
    `  cd "${L.worktree}" && git --no-pager diff           (nếu còn dở chưa commit)`,
    `Bối cảnh nhiệm vụ: ${L.task}`,
    ``,
    `Bất biến BẮT BUỘC soi: company_id ở mọi query + RLS/FORCE · bảng audit/snapshot append-only (app role không UPDATE/DELETE) · không secret plaintext (envelope+KMS phía app, không pgcrypto-in-SQL, không log).`,
    `CHỈ REVIEW — READ-ONLY. TUYỆT ĐỐI KHÔNG Edit/Write/sửa file/commit/đổi git state; chỉ đọc (Read/Grep/Glob + Bash chỉ-đọc như 'git diff'/chạy test). Tự ý sửa file = VI PHẠM hợp đồng review.`,
    `Trả DUY NHẤT verdict theo schema (reviewer="${rv.label}").`,
    `blocking=true CHỈ khi có lỗi CRITICAL/HIGH thật (rò tenant chéo, mất bất biến, secret lộ, silent failure, mất append-only). Nghi ngờ → ghi findings, KHÔNG tự ý blocking.`,
  ].join('\n');
}

// Gộp verdict reviewer độc lập vào kết quả implement (immutable — không sửa impl gốc).
function mergeVerdicts(impl, verdicts, L) {
  if (!verdicts.length) return impl;
  const summary = verdicts.map((v) => `${short(v.reviewer)}:${v.severity}`).join(' · ');
  const blocking = verdicts.filter((v) => v.blocking || v.severity === 'CRITICAL');
  if (blocking.length) {
    return {
      ...impl,
      status: 'needs_human',
      blockers: [
        ...(impl.blockers || []),
        ...blocking.flatMap((v) => (v.findings && v.findings.length ? v.findings : [v.summary])),
      ],
      summary: `${impl.summary} | REVIEW CHẶN: ${summary}`,
    };
  }
  return { ...impl, summary: `${impl.summary} | review OK: ${summary}` };
}

// KHÔNG dùng isolation:'worktree' — mỗi lane đã có worktree thật trên đĩa; agent cd vào đó qua Bash.
// pipeline 3 stage (không barrier — mỗi lane chảy độc lập): Plan → Implement → Review.
// - Plan:      crown-jewel → agent Opus lập micro-plan; lane thường → sentinel {__noPlan} (KHÔNG null!).
//              LÝ DO: pipeline DROP item khi 1 stage trả null/falsy → lane skipPlan/non-crown biến mất
//              khỏi Implement (0-token/0-agent). Bug tái diễn 3 lần (CONSOLE-1 ×2, acct2fe). Sentinel
//              non-null giữ item sống tới Implement; stage2 quy đổi sentinel về null cho prompt.
// - Implement: agent theo pickModel(L), nhận plan (nếu có) + gate-injection reviewer/skill + auto build-fix.
// - Review:    crown-jewel → spawn reviewer agent ĐỘC LẬP (agentType) trên diff → mergeVerdicts;
//              lane thường → trả nguyên (review đã chạy trong Implement qua gate-injection).
const rawResults = (
  await pipeline(
    lanes,
    (L) =>
      needsPlan(L)
        ? agent(plannerPrompt(L), {
            label: `plan:${L.id}`,
            phase: 'Plan',
            model: PLANNER_MODEL,
            schema: PLAN_SCHEMA,
          })
        : { __noPlan: true }, // sentinel non-null: KHÔNG trả null (pipeline drop item khi stage trả falsy)
    (plan, L) =>
      agent(implementerPrompt(L, plan && plan.__noPlan ? null : plan), {
        label: `lane:${L.id}`,
        phase: 'Implement',
        model: pickModel(L),
        schema: RESULT_SCHEMA,
      }),
    (impl, L) => {
      if (!impl) return impl;
      const reviewers = pickReviewers(L);
      if (!isCrown(L) || !reviewers.length) return impl; // việc thường: review đã làm trong Implement
      return parallel(
        reviewers.map((rv) => () =>
          agent(reviewPrompt(L, rv), {
            label: `review:${L.id}:${rv.label}`,
            phase: 'Review',
            model: pickModel(L),
            agentType: rv.agentType,
            schema: VERDICT_SCHEMA,
          }),
        ),
      ).then((verdicts) => mergeVerdicts(impl, verdicts.filter(Boolean), L));
    },
  )
);

// Lane trả null = agent implement chết (terminal API error / rate-limit sau retry) hoặc bị skip
// giữa chừng. KHÔNG nuốt âm thầm bằng .filter(Boolean) — nếu không, lane chết biến mất khỏi cả
// committed lẫn needsHuman và người vận hành tưởng "đã xong/sạch". Thay vào đó nổi lên thành
// status='dropped' kèm lane id: worktree CHƯA đụng lượt này → phải re-run (tránh dồn quá nhiều
// agent Opus crown cùng lúc gây rate-limit). rawResults[i] khớp lanes[i] theo index (pipeline giữ thứ tự).
const results = rawResults.map((r, i) =>
  r || {
    lane: lanes[i].id,
    status: 'dropped',
    summary: `⚠️ Lane ${lanes[i].id} bị DROP — agent trả null (nghi terminal API error / rate-limit sau retry, hoặc skip giữa chừng). Worktree CHƯA đụng lượt này → cần re-run.`,
    blockers: [
      `agent implement lane ${lanes[i].id} trả null — không có kết quả (nghi rate-limit/terminal error). Re-run lane này, đừng dồn quá nhiều Opus crown song song.`,
    ],
  },
);

const committed = results.filter((r) => r.status === 'committed');
const stuck = results.filter((r) => r.status !== 'committed');

log(`✅ Checkpoint commit: ${committed.map((r) => r.lane).join(', ') || '—'}`);
if (stuck.length) log(`🛑 Cần người chốt: ${stuck.map((r) => `${r.lane}(${r.status})`).join(', ')}`);

return {
  committed: committed.map((r) => ({ lane: r.lane, commit: r.commit, summary: r.summary })),
  needsHuman: stuck.map((r) => ({ lane: r.lane, status: r.status, blockers: r.blockers, summary: r.summary })),
};
