// harness/backlog.mjs — NGUỒN SỰ THẬT DUY NHẤT cho Work Order (máy đọc, zero-dep).
//
// Đọc bởi:
//   - harness/gen-status.mjs       → sinh docs/STATUS.md ("đang ở đâu, làm gì kế")
//   - .claude/hooks/guard-scope.mjs → cảnh báo khi sửa file NGOÀI `paths` của item in_progress
//
// Mỗi phần tử = 1 Work Order. Sửa file NÀY khi mở/đóng việc — KHÔNG nhồi tiến độ vào TASKS.md prose.
// Nền G1–G16 đã land master: lịch sử ở git + _journal.json, KHÔNG liệt lại ở đây (chống phình).
//
// Schema 1 item:
//   id          : mã ngắn ổn định (tham chiếu commit/PR)        — string, bắt buộc
//   title       : một câu mô tả                                  — string, bắt buộc
//   zone        : 'green' | 'yellow' | 'red'                     — quyết model/gate/autonomy (xem policy.md)
//   status      : 'todo' | 'in_progress' | 'done' | 'blocked'
//   paths       : glob[] file/vùng ĐƯỢC PHÉP đụng (guard-scope dùng)
//   skills      : string[] skill gợi ý sẵn cho việc này (bản tĩnh của ⑤; xem policy.md)
//   depends_on  : id[] phải 'done' trước khi item này 'ready'
//   done_when   : string[] tiêu chí HỘI TỤ (đích để dừng; verify chứng minh)

export const meta = {
  project: 'MediaOS',
  foundation:
    'G1–G16 đã land master (RLS·permission·audit·outbox·payroll·finance·workflow·task-hub). Lịch sử ở git.',
  direction:
    'v2 (owner 2026-06-19): đơn giản hoá để KIỂM SOÁT — tuần tự 1 tính năng/phiên, gộp FE 9→3 (auth·console·app), GIỮ backend (company_id/RLS ở N=1), redesign UX, trim chức năng, AI-first mỏng. Thay thế kế hoạch gộp-vào-apps/workspace cũ.',
  brain: 'Điều phối đa-agent (decompose/route/review/escalate) dùng .claude/workflows/parallel-lanes.mjs.',
};

export const backlog = [
  // ───────────────────────── ĐANG LÀM ─────────────────────────
  {
    id: 'HARNESS-SPINE',
    title: 'Dựng harness vận hành: State + Memory + Session + Work Order bền',
    zone: 'green',
    status: 'done', // 4 done_when đạt: init.sh in Work Order+handoff · gen-status sinh STATUS · check.sh · AGENTS.md+CLAUDE.md§1. (Baseline lint/typecheck ĐỎ là DEBT riêng — xem handoff Friction.)
    paths: ['harness/**', 'docs/STATUS.md', 'AGENTS.md', 'CLAUDE.md', '.claude/**'],
    skills: [],
    depends_on: [],
    done_when: [
      'node harness/gen-status.mjs sinh docs/STATUS.md từ git + _journal + backlog',
      'bash harness/check.sh gói lint+typecheck+test thành 1 lệnh',
      'bash harness/init.sh in được Work Order in_progress + handoff',
      'AGENTS.md slim tồn tại + CLAUDE.md §1 trỏ vào harness/',
    ],
  },

  // ───── v2 — FE rebuild 9→3 app (auth·console·app), GIỮ backend. Tuần tự 1 tính năng/phiên ─────
  // Owner 2026-06-19: thay thế FE-WS-1..4 (gộp-vào-apps/workspace). Sequence: ①auth → ②account → ③perm → ④console.
  {
    id: 'FE-AUTH-1',
    title: '① Đăng nhập: redesign apps/auth UX (login + 2FA), gieo ngôn ngữ thiết kế',
    zone: 'green',
    // DONE 2026-06-19: code đã land master (2042cad — login 'Phòng điều khiển' + đơn-tenant);
    // machine done_when xanh (login.spec 9/9 + typecheck); owner duyệt mắt UX OK. Mở khóa CONSOLE-1.
    status: 'done',
    paths: ['apps/auth/**', 'packages/web-core/**', 'packages/contracts/src/auth.ts', 'packages/ui/**'],
    skills: ['frontend-design', 'code-review'],
    depends_on: ['HARNESS-SPINE'],
    done_when: [
      'login + 2FA challenge redesigned, responsive; design tokens (brand/spectrum) tái dùng được',
      'web-core auth-api + i18n vi khớp; apps/auth/src/routes/login.spec xanh',
    ],
  },
  {
    id: 'ACCT-1',
    title: '②a Tài khoản (self-service): PATCH /users/me + POST /auth/change-password (authed+reauth) + FE',
    zone: 'yellow', // auth/account = nhạy cảm → reauth + deny-path test
    // DONE 2026-06-19: BE+FE đã có sẵn trong cây; gap THẬT đã vá = wire route /settings/account + nav item
    // (AccountSettingsPage trước đó import-nhưng-không-dùng → không tới được). int-spec 4/4 (lane mediaos_acct),
    // FE spec account.spec 8/8, security review PASS. Theo dõi: M1 (change-password thừa hưởng
    // @AllowWithoutTwoFactor ở cấp controller — defense-in-depth, bounded vì vẫn re-auth mật khẩu cũ) → handoff.
    status: 'done',
    paths: [
      'apps/api/src/users/**',
      'apps/api/src/auth/**',
      'packages/contracts/src/users.ts',
      'apps/console/src/routes/settings/**',
      'apps/console/src/lib/nav.ts',
      'apps/console/src/router.tsx',
      'packages/web-core/**',
    ],
    skills: ['code-review'],
    depends_on: ['FE-AUTH-1'],
    done_when: [
      'PATCH /users/me + POST /auth/change-password (re-auth mật khẩu cũ) có deny-path test (RED trước)',
      'FE màn hồ sơ + đổi mật khẩu; audit log hành động đổi mật khẩu',
    ],
  },
  {
    id: 'ACCT-2',
    title: '②b Quản trị user (admin): CRUD/mời/suspend/soft-delete + FE user-management',
    zone: 'yellow',
    status: 'todo',
    paths: ['apps/api/src/users/**', 'packages/contracts/src/users.ts', 'apps/console/**', 'apps/app/**'],
    skills: ['code-review'],
    depends_on: ['ACCT-1'],
    done_when: [
      'admin user CRUD + suspend + soft-delete (deleted_at, KHÔNG hard-delete) qua permission guard',
      'deny-path test khi thiếu quyền; FE danh sách + thao tác user',
    ],
  },
  {
    id: 'PERM-UI-1',
    title: '③ Phân quyền: giữ engine 4-tier, wire Tier-2 scope nếu cần + redesign role/permission UI',
    zone: 'yellow',
    status: 'todo',
    paths: ['apps/api/src/permission/**', 'apps/console/**', 'apps/app/**', 'packages/web-core/**'],
    skills: ['code-review'],
    depends_on: ['ACCT-2'],
    done_when: [
      'role/permission UI redesigned; useCan/PermissionGate giữ nguyên hợp đồng',
      'KHÔNG sửa shape engine trừ khi Tier-2 scope thật sự cần; test permission xanh',
    ],
  },
  {
    id: 'CONSOLE-1',
    title: '④ Quản trị hệ thống: redesign apps/console, hút màn devops hữu ích từ operator plane',
    zone: 'green',
    status: 'todo',
    paths: ['apps/console/**', 'packages/web-core/**', 'packages/ui/**'],
    skills: ['frontend-design', 'code-review'],
    depends_on: ['FE-AUTH-1'],
    done_when: [
      'console hút audit viewer + queue monitor + api-keys + webhooks + db-ops từ apps/admin',
      'bỏ bề mặt multi-company (companies list / tenant switch / aud=operator); web test console xanh',
    ],
  },
  {
    id: 'APP-MERGE-1',
    title: 'Dựng apps/app (shell hợp nhất): studio (work/process/goals) + people (hr/payroll) + projects (PM)',
    zone: 'yellow', // chạm payroll FE → mask/re-auth phải giữ
    status: 'todo',
    paths: ['apps/app/**', 'apps/studio/**', 'apps/people/**', 'apps/projects/**', 'packages/web-core/**'],
    skills: ['frontend-design', 'code-review'],
    depends_on: ['PERM-UI-1', 'CONSOLE-1'],
    done_when: [
      'studio/people/projects route gộp vào apps/app; payslip money-free + re-auth giữ nguyên',
      'gỡ shell trùng; CI apps-frontend path-filter trỏ về app/auth/console; web test xanh',
    ],
  },
  {
    id: 'TRIM-1',
    title: 'Trim chức năng: gộp defect→tasks(labels), gỡ template-clone/recycle-bin nếu không dùng',
    zone: 'yellow',
    status: 'todo',
    paths: ['apps/api/src/defect/**', 'apps/api/src/tasks/**', 'apps/api/src/templates/**'],
    skills: ['code-review'],
    depends_on: ['HARNESS-SPINE'],
    done_when: [
      'audit usage thật trước khi gỡ (không gỡ mù)',
      'test còn xanh; không rò bất biến',
    ],
  },
  {
    id: 'AI-1',
    title: 'AI insight v1 (read-only): KPI insight đọc kpi+finance → tóm tắt, KHÔNG ghi DB',
    zone: 'yellow', // đọc dữ liệu nhạy cảm → mask + permission, nhưng không mutate
    status: 'todo',
    paths: ['apps/api/src/ai/**', 'packages/contracts/src/ai.ts'],
    skills: ['code-review'],
    depends_on: ['HARNESS-SPINE'],
    done_when: [
      'module ai/ gọi Claude API (opus/sonnet) đọc kpi_results + cost_records đã mask theo permission',
      'không thêm bảng mới; không ghi; deny-path test khi thiếu quyền',
    ],
  },
];
