export const meta = {
  name: 'parallel-lanes',
  description: 'Fan-out 1 round micro-step (RED→GREEN→gate→checkpoint) trên nhiều lane MediaOS song song',
  whenToUse: 'Khi muốn đẩy nhiều phase G* cùng lúc — mỗi lane 1 worktree + 1 band migration riêng (TASKS.md §5).',
  phases: [{ title: 'Fan-out', detail: 'mỗi lane 1 agent trong worktree+band của nó, chạy 1 round micro-step' }],
};

// args = {
//   lanes: [
//     { id: 'g11', worktree: 'c:/dev 2/mediaos-g11-hr', band: '0060-0069',
//       task: 'G11-1 attendance: schema + check-in/out + RLS + deny-path test',
//       gate: 'FULL', mode: 'TDD' },           // mode: 'TDD' (🛠️) | 'AI-bulk' (🤖)
//     ...
//   ]
// }

const lanes = args && Array.isArray(args.lanes) ? args.lanes : [];
if (!lanes.length) {
  log('⚠️  Không có lane nào trong args.lanes. Truyền { lanes: [{ id, worktree, band, task, gate, mode }] } (xem TASKS.md §5).');
  return { error: 'no lanes provided' };
}

phase('Fan-out');
log(`Fan-out ${lanes.length} lane: ${lanes.map((l) => l.id).join(', ')}`);

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

function lanePrompt(L) {
  const tddStep = L.mode === 'TDD'
    ? '1) Viết deny-path/contract test RED TRƯỚC (CLAUDE.md §6). Xác nhận test ĐỎ vì lý do đúng.'
    : '1) Bỏ qua RED riêng nếu là 🤖 CRUD thuần — nhưng vẫn phải có test cho hành vi mới.';
  return [
    `Bạn vận hành LANE ${L.id.toUpperCase()} của dự án MediaOS.`,
    `Worktree DUY NHẤT được phép đụng: ${L.worktree}. Band migration: ${L.band}.`,
    `Mọi lệnh git/pnpm chạy bằng: cd "${L.worktree}" && <lệnh>.`,
    ``,
    `ĐỌC TRƯỚC: ${L.worktree}/CLAUDE.md (đặc biệt §9 vận hành song song) + ${L.worktree}/TASKS.md §5.`,
    ``,
    `NHIỆM VỤ LƯỢT NÀY: ${L.task}`,
    `Chế độ: ${L.mode}. Gate: ${L.gate}.`,
    ``,
    `VÒNG MICRO-STEP BẮT BUỘC (TASKS.md §5.5):`,
    tddStep,
    `2) Implement TỐI THIỂU để GREEN. Migration (nếu có) PHẢI nằm trong band ${L.band}; _journal.json idx/when đơn điệu tăng.`,
    `3) Chạy gate ${L.gate} + 'pnpm --filter @mediaos/api typecheck' + test liên quan. (FULL = security/database/silent-failure reviewer cho diff permission/RLS/secret/payroll/audit.)`,
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

// KHÔNG dùng isolation:'worktree' — mỗi lane đã có worktree thật trên đĩa; agent cd vào đó qua Bash.
const results = (
  await parallel(
    lanes.map((L) => () =>
      agent(lanePrompt(L), { label: `lane:${L.id}`, phase: 'Fan-out', schema: RESULT_SCHEMA }),
    ),
  )
).filter(Boolean);

const committed = results.filter((r) => r.status === 'committed');
const stuck = results.filter((r) => r.status !== 'committed');

log(`✅ Checkpoint commit: ${committed.map((r) => r.lane).join(', ') || '—'}`);
if (stuck.length) log(`🛑 Cần người chốt: ${stuck.map((r) => `${r.lane}(${r.status})`).join(', ')}`);

return {
  committed: committed.map((r) => ({ lane: r.lane, commit: r.commit, summary: r.summary })),
  needsHuman: stuck.map((r) => ({ lane: r.lane, status: r.status, blockers: r.blockers, summary: r.summary })),
};
