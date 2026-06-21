// harness/backlog.mjs — NGUỒN SỰ THẬT DUY NHẤT cho Work Order (máy đọc, zero-dep).
//
// Đọc bởi:
//   - harness/gen-status.mjs       → sinh docs/STATUS.md ("đang ở đâu, làm gì kế")
//   - .claude/hooks/guard-scope.mjs → cảnh báo khi sửa file NGOÀI `paths` của item in_progress
//
// Mỗi phần tử = 1 Work Order. Sửa file NÀY khi mở/đóng việc — KHÔNG nhồi tiến độ vào prose doc (docs/STATUS.md tự sinh từ file này).
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
    // RED (red-zone-scanner 2026-06-21): paths chạm engine can() (permission.service.ts), hợp đồng useCan/PermissionGate,
    // và role grant/revoke ghi audit_logs + emit permission.changed in-tx → authz + audit append-only. Cần lane đỏ + FULL gate.
    // DONE 2026-06-21 (auto, song song DB-2, owner waive chốt): tech-lead chứng minh Tier-2 data_scope CHƯA tồn tại
    // (role_permissions không có cột data_scope) → engine/useCan/PermissionGate ĐÓNG BĂNG, thu về THUẦN FE redesign (green).
    // 6 file FE: page + 3 dialog (assign/revoke/object) redesign theo "Phòng điều khiển" + i18n vi + spec gating. Read-API
    // hiện-trạng-grant + wire Tier-2 TÁCH sang PERM-UI-2. completion-evaluator PASS 96/100, contract-freeze use-can/
    // permission-gate xanh (59/59 web-core), console 177/177, typecheck clean. Vùng đóng băng sạch (git diff).
    zone: 'red',
    status: 'done',
    paths: ['apps/api/src/permission/**', 'apps/console/**', 'apps/app/**', 'packages/web-core/**'],
    skills: ['code-review'],
    depends_on: ['ACCT-2'],
    done_when: [
      'role/permission UI redesigned; useCan/PermissionGate giữ nguyên hợp đồng',
      'KHÔNG sửa shape engine trừ khi Tier-2 scope thật sự cần; test permission xanh',
    ],
  },
  {
    id: 'PERM-UI-2',
    title: 'Phân quyền v2: read-API hiện-trạng grant (role/object-permission của user) + (Phase) wire Tier-2 data_scope',
    // TÁCH từ PERM-UI-1 (2026-06-21): tech-lead chứng minh role_permissions KHÔNG có cột data_scope → engine 4-tier sạch.
    // Wire Tier-2 = thêm cột DB + migration + đổi thuật toán can() → CHẠM lane migration nối tiếp (đụng FOUNDATION-DB-2).
    // Read-API hiện-trạng grant = THÊM @Get vào permission-admin.controller (crown) + trả dữ liệu phân quyền (rò = leak ai-có-quyền-gì) → FULL gate + Opus.
    // ⚠️ Sub-phase data_scope BẮT BUỘC xếp sau chuỗi FOUNDATION-DB (giành slot migration), KHÔNG chạy song song migration khác.
    zone: 'red',
    status: 'todo',
    paths: [
      'apps/api/src/permission/permission-admin.controller.ts',
      'apps/api/src/permission/permission-admin.repository.ts',
      'apps/api/src/permission/permission-admin.service.ts',
      'packages/contracts/src/permission.ts',
      'apps/console/src/routes/system/permissions/**',
      'apps/console/src/lib/rbac-api.ts',
    ],
    skills: ['code-review'],
    depends_on: ['PERM-UI-1'],
    done_when: [
      'read-API GET hiện-trạng grant (role của 1 user + object-permission list) qua @RequirePermission + tenant-scope; deny-path test RED (user thiếu quyền → 403, không rò grant user khác)',
      'dialog revoke/object hiển thị state hiện hữu (hết "thao tác mù"); useCan/PermissionGate giữ nguyên hợp đồng',
      '(Phase sau, sau FOUNDATION-DB chain) wire Tier-2 data_scope: cột role_permissions.data_scope + migration nối tiếp + nhánh deny-scope trong can() + RED test scope — TÁCH sub-WO migration riêng',
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
    // RED (red-zone-scanner 2026-06-21): defect/templates chạm permission+audit+FSM; tasks/** là module MVP TASK (KHÔNG parked);
    // gỡ defect orphan AUDIT_OBJECT_TYPES 'defect' (mirror DB CHECK, UNION-append-only → phá BẤT BIẾN #2). Re-scope + lane đỏ trước khi gỡ.
    zone: 'red',
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
  // ═════ MVP BUILDOUT — Wave 1: FOUNDATION (EPIC-01, Sprint 1) ═════
  // Seed 2026-06-21 từ gap-analysis (docs/plans/MVP-WORK-BREAKDOWN.md + mvp-work-orders.json, 141 WO tổng).
  // FOUNDATION = critical path mở khóa AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH. Phần lớn ĐỎ (migration/audit/settings/files) → người + FULL gate.
  // codeState=wrong-shape: hạ tầng G1–G16 có nhưng audit/settings/files/sequence/holidays LỆCH spec DB-08. Migration nối tiếp từ head 0430.
  {
    id: 'FOUNDATION-DB-1',
    title: 'Migration system_settings + company_settings (RLS+FORCE) theo DB-08 §8.3/8.4',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/migrations/0431_*.sql', 'apps/api/src/db/schema/settings.ts', 'apps/api/src/db/schema/index.ts'],
    skills: ['code-review'],
    depends_on: [],
    done_when: [
      'company_settings có company_id NOT NULL + RLS ENABLE+FORCE + policy USING/WITH CHECK company_id=current_setting(\'app.current_company_id\') TẠO TRƯỚC mọi INSERT/backfill (CLAUDE.md §3)',
      'system_settings (no company_id, global) + company_settings có cột theo DB-08: setting_key/setting_value(jsonb)/value_type/category/module_code/is_public/is_sensitive/is_encrypted/secret_ref/validation_schema/status + CHECK value_type/status (DB-08 §8.3/8.4 constraint)',
      'uq company_settings (company_id,setting_key) WHERE deleted_at IS NULL AND status=\'Active\' + uq system_settings(setting_key) WHERE status=\'Active\'',
      'drizzle schema settings.ts parity với SQL + export trong schema/index.ts (append, không rewrite)',
    ],
  },
  {
    id: 'FOUNDATION-DB-2',
    title: 'Migration audit_logs nâng cấp về DB-08 shape (giữ append-only) hoặc bảng audit chuẩn',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/migrations/0432_*.sql', 'apps/api/src/db/schema/audit.ts'],
    skills: ['code-review'],
    depends_on: [],
    done_when: [
      'audit_logs có đủ cột DB-08 §8.5: module_code/action/entity_type/entity_id/actor_type/old_values/new_values/changed_fields/sensitivity_level/result_status/request_id/correlation_id/ip_address/user_agent (additive, giữ cột cũ nếu cần để không vỡ ghi hiện tại)',
      'CHECK actor_type/sensitivity_level/result_status theo DB-08; GIỮ append-only: app role REVOKE UPDATE/DELETE vẫn còn (BẤT BIẾN #2) — verify bằng test ghi-rồi-update phải fail',
      'index company_id+created_at desc, module_code+entity_type+entity_id, request_id, correlation_id (DB-08 §8.5)',
      'migration đơn điệu sau head 0430 (idx 113), RLS company_id giữ nguyên FORCE',
    ],
  },
  {
    id: 'FOUNDATION-DB-3',
    title: 'Migration files + file_links + file_access_logs (RLS+FORCE, polymorphic có kiểm soát) theo DB-08 §8.6-8.8',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/migrations/0433_*.sql', 'apps/api/src/db/schema/files.ts', 'apps/api/src/db/schema/index.ts'],
    skills: ['code-review'],
    depends_on: [],
    done_when: [
      '3 bảng có company_id NOT NULL + RLS ENABLE+FORCE + policy company_id TẠO TRƯỚC backfill (CLAUDE.md §3)',
      'files có upload_status(Pending/Uploaded/Failed/Deleted) + scan_status(NotRequired/Pending/Clean/Infected/Failed) + visibility(Private/Internal/Public) + storage_provider/storage_path/checksum_sha256 + CHECK đúng DB-08 §8.6; default visibility=Private',
      'file_links polymorphic (module_code/entity_type/entity_id) + CHECK link_type/access_scope + uq is_primary per entity (DB-08 §8.7); file_access_logs CHECK action Preview/Download/Upload/Delete/Link/Unlink/GenerateSignedUrl (DB-08 §8.8)',
      'file_access_logs append-only (REVOKE UPDATE/DELETE app role); drizzle parity files.ts',
    ],
  },
  {
    id: 'FOUNDATION-DB-4',
    title: 'Migration sequence_counters + public_holidays (RLS+FORCE, company_id nullable cho global) theo DB-08 §8.9-8.10',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/migrations/0434_*.sql', 'apps/api/src/db/schema/sequences.ts', 'apps/api/src/db/schema/holidays.ts', 'apps/api/src/db/schema/index.ts'],
    skills: ['code-review'],
    depends_on: [],
    done_when: [
      'sequence_counters có (company_id nullable, sequence_key, current_value, prefix, padding_length, reset_policy, suffix) + uq (company_id,sequence_key); public_holidays (company_id nullable, country_code, holiday_date, name, is_paid_holiday) theo DB-08 §8.9/8.10',
      'RLS+FORCE cho company-scoped rows; row company_id NULL chỉ truy cập qua system/global path (DB-08 §5.3) — policy không rò chéo tenant',
      'uq tránh trùng holiday (company_id/country_code, holiday_date) + index holiday_date range',
      'migration nối tiếp sau 0433; drizzle parity',
    ],
  },
  {
    id: 'FOUNDATION-DB-5',
    title: 'Migration data_retention_policies + seed_batches + seed_items + seed modules catalog/permission/system_settings (idempotent)',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/migrations/0435_*.sql', 'apps/api/src/db/schema/retention.ts', 'apps/api/src/db/schema/seed-tracking.ts', 'apps/api/src/db/schema/index.ts'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-1'],
    done_when: [
      'data_retention_policies + seed_batches + seed_items theo DB-08 §8.11-8.13 (RLS+FORCE nếu company_id; seed_items có seed_key/checksum/status)',
      'seed modules catalog DB-08 §8.2 (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI active + PAYROLL.. inactive) — bảng modules CHUẨN spec, KHÔNG đụng system_modules SaaS hiện có',
      'seed system_settings mặc định (file.max_upload_size_mb, file.allowed_mime_types, system.default_timezone/locale, audit.default_retention_days) bằng ON CONFLICT DO NOTHING (idempotent — chạy lại không trùng)',
      'seed permission Foundation theo model (action,resource) hiện tại của permission engine (KHÔNG chuỗi dotted) — ON CONFLICT DO NOTHING',
    ],
  },
  {
    id: 'FOUNDATION-BE-1',
    title: 'SettingService: precedence company→system→default + /settings/public (lọc is_public, mask is_sensitive) + admin update có audit',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/src/foundation/settings/**', 'apps/api/src/settings/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-1', 'FOUNDATION-BE-3'],
    done_when: [
      'resolveSetting(companyId,key) trả theo precedence company_settings→system_settings→fallback (BACKEND-11 §13.3); resolveMany hỗ trợ batch',
      'GET /api/v1/foundation/settings/public CHỈ trả setting is_public=true AND is_sensitive=false; KHÔNG bao giờ trả secret_ref/raw secret (BACKEND-11 §13.4, security test)',
      'PATCH setting validate value_type + validation_schema, ghi audit_logs CONFIG_UPDATE old/new/changed_fields trong cùng tx withTenant (BACKEND-04 §14.2)',
      'deny-path test (RED): user thiếu FOUNDATION setting permission → 403; public endpoint không lộ sensitive (BACKEND-04 §18.4)',
    ],
  },
  {
    id: 'FOUNDATION-BE-2',
    title: 'SequenceService.nextCode transaction + FOR UPDATE row lock + preview (không tăng) + ensureCounter',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/src/foundation/sequences/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-4'],
    done_when: [
      'nextCode chạy trong tx, SELECT ... FOR UPDATE trên sequence_counters; KHÔNG dùng MAX(code)+1 (DB-08 §5.10, BACKEND-04 §14.5)',
      'format code theo prefix/padding/datePattern/suffix + reset_policy Never/Yearly/Monthly/Daily (BACKEND-04 §8.6)',
      'previewNextCode trả mã kế tiếp KHÔNG mutate counter; admin PATCH sequence ghi audit',
      'integration test concurrent N request đồng thời → 0 mã trùng (BACKEND-04 §18.2.3)',
    ],
  },
  {
    id: 'FOUNDATION-BE-3',
    title: 'AuditService v2 (DB-08 shape) + AuditMaskerService + audit-list/detail API theo permission+scope',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/src/foundation/audit/**', 'apps/api/src/events/audit.service.ts'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-2'],
    done_when: [
      'write() điền đủ field DB-08 (module_code/action/entity_type/actor_type/sensitivity_level/result_status), tự tính changed_fields từ old/new, ghi trong cùng tx withTenant (giữ outbox/append-only)',
      'AuditMaskerService mask password/token/secret/secret_ref/identity_number/bank_account/storage_path/signed_url TRƯỚC insert — test mask không vỡ cấu trúc diff (BACKEND-11 §12.5)',
      'GET /api/v1/foundation/audit-logs (+ /{id}) filter module_code/action/actor/entity/from-to/request_id; data scope Company chỉ thấy audit company hiện tại, System mới thấy toàn hệ thống (BACKEND-04 §9.5)',
      'deny-path test (RED): Employee gọi audit-logs → 403; response KHÔNG chứa token/password/storage_path (BACKEND-04 §18.3/18.4)',
    ],
  },
  {
    id: 'FOUNDATION-BE-4',
    title: 'FileService: upload metadata + StorageAdapter port + link/unlink + download-qua-backend + file_access_log',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/src/foundation/files/**', 'apps/api/src/storage/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-3', 'FOUNDATION-BE-3', 'FOUNDATION-BE-5'],
    done_when: [
      'upload ghi metadata files (visibility=Private default) + validate size theo file.max_upload_size_mb, MIME theo file.allowed_mime_types (KHÔNG tin MIME client), sanitize filename chống path traversal (BACKEND-11 §11.6)',
      'StorageAdapter port (putObject/getObject/deleteObject/signedUrl) — adapter S3 hiện có bọc lại; KHÔNG trả storage_path/signed_url dài hạn cho FE (BACKEND-04 §14.4)',
      'download flow: AuthGuard→PermissionGuard→FilePolicyService resolve theo file_links/module owner→kiểm visibility/deleted_at/upload_status→ghi file_access_logs nếu private/sensitive→stream/signed URL ngắn hạn (BACKEND-11 §11.9)',
      'link/unlink validate entity cùng company + scan_status!=Infected; soft-delete file không hard-delete; audit Upload/Link/Unlink/Delete (DB-08 §8.7 rule, BACKEND-11 §11.12)',
    ],
  },
  {
    id: 'FOUNDATION-BE-5',
    title: 'FilePolicyService + FileOwnerPermissionResolver registry (deny-by-default, dispatch theo module_code/entity_type)',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/src/foundation/files/file-policy.service.ts', 'apps/api/src/foundation/files/resolvers/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-3'],
    done_when: [
      'FileOwnerPermissionResolver interface (canView/canDownload/canLink/canDelete) + registry dispatch theo (module_code,entity_type) (BACKEND-04 §11.4)',
      'Không resolve được entity/module → TỪ CHỐI truy cập (deny-by-default, fail-closed — BACKEND-11 §11.10)',
      'fallback chỉ cho user có Foundation file permission khi chưa có resolver; HR/LEAVE/TASK đăng ký resolver được (contract sẵn cho module sau)',
      'unit test resolver fallback + deny-by-default (BACKEND-04 §18.1 FilePermissionService)',
    ],
  },
  {
    id: 'FOUNDATION-BE-6',
    title: 'HolidayService: CRUD public_holidays + isWorkingDay (global+company override) + getHolidaysInRange + internal contract cho ATT/LEAVE',
    zone: 'green',
    status: 'todo',
    paths: ['apps/api/src/foundation/holidays/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-4'],
    done_when: [
      'isWorkingDay(companyId,date) kết hợp weekend (company setting/workingDaysJson) + public_holidays; company-specific override holiday global cùng ngày (BACKEND-11 §16.2, BACKEND-04 §11.6)',
      'getHolidaysInRange batch (không gọi từng ngày N lần) cho ATT/LEAVE; CRUD holiday qua permission FOUNDATION holiday (BACKEND-04 §9.8)',
      'GET /api/v1/foundation/public-holidays + check-working-day theo query year/month/country_code/company_only',
      'unit test working-day + override global/company (BACKEND-04 §18.1 HolidayService)',
    ],
  },
  {
    id: 'FOUNDATION-BE-7',
    title: 'CompanyService /company/current (GET/PATCH có audit) + ModuleCatalogService my-apps (lọc theo permission+module active+setting)',
    zone: 'yellow',
    status: 'todo',
    paths: ['apps/api/src/foundation/company/**', 'apps/api/src/foundation/module-catalog/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-5', 'FOUNDATION-BE-3'],
    done_when: [
      'GET /api/v1/foundation/company/current trả company từ AuthContext (KHÔNG nhận company_id body); PATCH ghi audit CONFIG_UPDATE; company Suspended chặn nghiệp vụ (BACKEND-04 §8.1)',
      'GET /modules/my-apps lọc app theo: module is_active AND company setting enabled AND user có ≥1 required permission (BACKEND-04 §11.7 visibility rule) — đọc catalog modules spec (KHÔNG system_modules SaaS)',
      'recent/favorite/open: nếu chưa có bảng user_module_preferences thì trả rỗng + ghi TODO rõ (BACKEND-04 §19 Phase2.5), KHÔNG bịa dữ liệu',
      'permission/scope test: user thiếu permission gọi my-apps → 200 nhưng app bị lọc (BACKEND-04 §18.3)',
    ],
  },
  {
    id: 'FOUNDATION-BE-8',
    title: 'SeedTrackingService idempotent + RetentionService CRUD + cleanup job skeleton (dry-run, không xóa thật)',
    zone: 'yellow',
    status: 'todo',
    paths: ['apps/api/src/foundation/seed/**', 'apps/api/src/foundation/retention/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-DB-5'],
    done_when: [
      'SeedTrackingService startBatch/markItem*/finishBatch ghi seed_batches/seed_items với checksum; chạy lại không tạo trùng (idempotent — BACKEND-04 §11.8)',
      'RetentionService CRUD policy + run-dry simulate đếm record eligible, KHÔNG xóa khi is_enforced=false (BACKEND-11 §17.4 safety)',
      'cleanup job skeleton có dry-run mode + ghi system/audit log khi chạy; KHÔNG xóa audit_logs nếu policy chưa active (BACKEND-11 §18)',
      'unit test seed idempotent + retention simulate không xóa thật (BACKEND-04 §18.1 SeedTrackingService)',
    ],
  },
  {
    id: 'FOUNDATION-BE-9',
    title: 'FoundationModule + foundation contracts (Zod DTO) + wire vào app.module.ts (additive)',
    zone: 'green',
    status: 'todo',
    paths: ['apps/api/src/foundation/foundation.module.ts', 'apps/api/src/app.module.ts', 'packages/contracts/src/foundation/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-BE-1', 'FOUNDATION-BE-3', 'FOUNDATION-BE-4', 'FOUNDATION-BE-6', 'FOUNDATION-BE-7'],
    done_when: [
      'FoundationModule gom company/module-catalog/settings/audit/files/sequence/holidays/retention/seed; import vào app.module.ts khối additive (KHÔNG rewrite — CLAUDE.md §9.3)',
      'packages/contracts có Zod DTO cho mọi response Foundation (company/my-apps/settings.public/file upload/audit/holiday) = nguồn sự thật, dual-build',
      'mọi public endpoint /api/v1/foundation/* qua AuthGuard+PermissionGuard; response envelope {success,message,data,meta} (BACKEND-11 §10)',
      'pnpm --filter @mediaos/api build + typecheck XANH; OpenAPI/Swagger render endpoint Foundation (BACKEND-04 §22.17)',
    ],
  },
  {
    id: 'FOUNDATION-QA-1',
    title: 'QA hardening Foundation: permission/scope + file security + sequence concurrency + audit masking + public settings leak',
    zone: 'red',
    status: 'todo',
    paths: ['apps/api/src/foundation/**/*.spec.ts', 'apps/api/test/foundation/**'],
    skills: ['code-review'],
    depends_on: ['FOUNDATION-BE-1', 'FOUNDATION-BE-2', 'FOUNDATION-BE-3', 'FOUNDATION-BE-4', 'FOUNDATION-BE-6', 'FOUNDATION-BE-7', 'FOUNDATION-BE-8'],
    done_when: [
      'permission/scope test pass: Employee→audit 403; admin xem company hiện tại 200, company khác 403; my-apps lọc app (BACKEND-04 §18.3)',
      'file security: upload .exe đổi đuôi .pdf bị chặn, filename ../../ sanitize, soft-deleted file không download được, response không lộ storage_path/signed_url (BACKEND-04 §18.4)',
      'sequence concurrency test 0 trùng; audit masking test không lộ token/password; public settings không trả sensitive (BACKEND-04 §18.2/18.4)',
      'append-only test: UPDATE/DELETE audit_logs bằng app role FAIL (BẤT BIẾN #2); coverage module nhạy cảm ≥80% (CLAUDE.md §6)',
    ],
  },

];
