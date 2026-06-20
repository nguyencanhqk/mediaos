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
  project: 'Hệ thống Quản lý Doanh nghiệp (de-media-fy 2026-06-20)',
  spec: 'Nguồn sự thật sản phẩm = docs/spec/ (SPEC-01…08). MVP = AUTH·HR·ATT·LEAVE·TASK·DASH·NOTI.',
  foundation:
    'Nền backend G1–G16 đã land master (RLS·permission·audit·outbox + giữ lại). De-media-fy: media·workflow-DAG·payroll·finance·SaaS·mobile PARKED (out-of-scope, không xóa) — xem docs/SYSTEM-DESIGN.md §14. Lịch sử ở git.',
  direction:
    'v2 (owner 2026-06-19, reframe 2026-06-20): đơn giản hoá để KIỂM SOÁT — tuần tự 1 tính năng/phiên. De-media-fy thành hệ QLDN chung; GIỮ backend hạ tầng (company_id/RLS ở N=1, audit, permission); xây/redesign 7 module MVP theo docs/spec/. FE: auth·console·app. Khi code cũ mâu thuẫn spec → spec thắng.',
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
    title: '②b Quản trị user (admin) BACKEND: CRUD/mời/suspend/soft-delete + contracts',
    zone: 'yellow',
    // DONE 2026-06-20 (merge b1b53ec): BE-only. admin-users controller/service/repo + mig 0430 (perm sensitive
    // suspend:user/delete-user:user + grant). Review độc lập RLS+security OK 0 blocking; full API 2748 pass.
    // FE user-management tách sang ACCT-2-FE (Wave 2, trong vỏ console mới). Follow-up: AUTH-FIX-1 (suspended login).
    status: 'done',
    paths: ['apps/api/src/users/**', 'packages/contracts/src/users.ts'],
    skills: ['code-review'],
    depends_on: ['ACCT-1'],
    done_when: [
      'admin user CRUD + suspend + soft-delete (deleted_at, KHÔNG hard-delete) qua permission guard',
      'deny-path test khi thiếu quyền (RED trước)',
    ],
  },
  {
    id: 'ACCT-2-FE',
    title: '②b-FE Quản trị user: màn danh sách + thao tác (suspend/soft-delete/mời) trong vỏ console mới',
    zone: 'yellow',
    // DONE 2026-06-20 (Wave 2a, merge 2c1ac49): UsersPage (TanStack Table + filter q/status + pagination +
    // loading/error/empty) + suspend/delete/invite dialog; gating useCan/PermissionGate bằng hằng (manage/
    // suspend/delete-user/invite:user); reuse consoleInvitesApi cho mời; api-client validate Zod. Chạy qua
    // Agent tool (workflow drop lane skipPlan — đã vá sentinel). Verify master: console 173/173 + typecheck OK.
    status: 'done',
    paths: ['apps/console/src/routes/system/users/**', 'packages/web-core/**'],
    skills: ['frontend-design', 'code-review'],
    depends_on: ['ACCT-2', 'CONSOLE-1'],
    done_when: [
      'FE danh sách user + thao tác (suspend/reactivate/soft-delete/mời) gọi API ACCT-2 qua permission guard (useCan/PermissionGate)',
      'web test console xanh; không hard-code quyền; mask dữ liệu nhạy cảm theo server',
    ],
  },
  {
    id: 'AUTH-FIX-1',
    title: 'Chặn login khi user status=suspended (login hiện chỉ lọc deleted_at) — bổ trợ ACCT-2 suspend',
    zone: 'red', // chạm auth login flow — nhạy cảm, FULL gate + deny-path test RED trước
    // DONE 2026-06-20 (Wave 2a, merge 67e7f2f, red→human-chốt): allow-list fail-closed status==='active' tại
    // CẢ 3 đường cấp token (login sau password.verify; refresh thu hồi family; 2FA step-2 — đường thứ 3 ask
    // gốc bỏ sót). 401 đồng nhất anti status-probing, reason chỉ vào audit_logs. Không migration. Chạy qua
    // workflow (Opus+plan+reviewer độc lập LOW). Verify: spec 10/10 + full api 2758 pass/0 fail.
    status: 'done',
    // Phát hiện bởi lane ACCT-2 (2026-06-20): auth.service.ts:302-306 chỉ lọc deleted_at →
    // user bị suspend VẪN đăng nhập được. Soft-delete đã chặn; suspend thì chưa. Để riêng vì chạm auth hot/shared.
    paths: ['apps/api/src/auth/**'],
    skills: ['code-review'],
    depends_on: ['ACCT-2'],
    done_when: [
      'login + refresh chặn user status=suspended (deny-path test RED trước); soft-delete giữ nguyên đã chặn',
      'không phá luồng login user active; không lộ lý do chi tiết gây dò trạng thái',
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
    // DONE 2026-06-20 (merge b1b53ec): design "Phòng điều khiển" áp sang console + hút api-keys/webhooks
    // (tenant-plane, KHÔNG hút operator cross-tenant); console vốn không có bề mặt multi-company. test 161/161.
    status: 'done',
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
    title: 'Dựng apps/app (shell hợp nhất) cho module MVP: HR · ATT · LEAVE · TASK · DASH · NOTI (theo docs/spec/)',
    zone: 'yellow',
    status: 'todo',
    // RESCOPE 2026-06-20 (de-media-fy): bỏ framing studio/people/payroll/projects cũ. apps/app gom 7 module MVP.
    // payroll = Phase 2 (parked) → KHÔNG đưa payslip vào shell này. Lấy docs/spec/ làm chuẩn.
    paths: ['apps/app/**', 'apps/studio/**', 'apps/people/**', 'apps/projects/**', 'packages/web-core/**'],
    skills: ['frontend-design', 'code-review'],
    depends_on: ['PERM-UI-1', 'CONSOLE-1'],
    done_when: [
      'route 7 module MVP (HR·ATT·LEAVE·TASK·DASH·NOTI) gộp vào apps/app theo docs/spec/; KHÔNG có payslip/payroll',
      'gỡ shell trùng; CI apps-frontend path-filter trỏ về app/auth/console; web test xanh',
    ],
  },
  {
    id: 'TRIM-1',
    title: 'Trim chức năng hướng cũ: gỡ/park media·workflow-DAG·defect·template-clone·recycle-bin không thuộc spec MVP',
    zone: 'yellow',
    status: 'todo',
    // RESCOPE 2026-06-20 (de-media-fy): defect/workflow-DAG thuộc subsystem parked. Audit usage thật, gỡ an toàn,
    // KHÔNG đụng bảng/route module MVP. Mục tiêu: thu hẹp bề mặt code về đúng 7 module spec.
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
    // DONE 2026-06-20 (merge 1cf12e6): module ai/ đọc kpi_results + cost_records MASK qua Claude, read-only.
    // PARKED 2026-06-20 (de-media-fy): đọc kpi/finance = subsystem parked; AI là Phase 5 trong docs/spec/.
    //   Giữ 'done' (lịch sử), KHÔNG phát triển tiếp ở MVP. Không tham chiếu khi làm module spec.
    status: 'done',
    paths: ['apps/api/src/ai/**', 'packages/contracts/src/ai.ts'],
    skills: ['code-review'],
    depends_on: ['HARNESS-SPINE'],
    done_when: [
      'module ai/ gọi Claude API (opus/sonnet) đọc kpi_results + cost_records đã mask theo permission',
      'không thêm bảng mới; không ghi; deny-path test khi thiếu quyền',
    ],
  },
];
