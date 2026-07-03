# Bàn giao phiên — Memory tầng 2 (phiên trước → phiên sau)

> `harness/finish.sh` nhắc ghi vào đây cuối phiên; `harness/init.sh` đọc đầu phiên.
> Ghi NGẮN gọn. Cũ đẩy xuống "Lịch sử". Quyết định kiến trúc → ghi vào `docs/DECISIONS/`, không nhồi vào đây.
> Ô **Friction**: ghi cái gì làm tay/khó lặp lại — cùng một friction xuất hiện **≥2 lần** ⇒ gọi skill `skill-smith` để đóng băng thành skill.

## Phiên 2026-07-02→03 (session eebe431a) — wave carry-over `feat/carryover-wave1`: 9 WO SHIPPED, 3 quyết định owner ĐÃ ÁP DỤNG

- **Shipped (merged vào feat/carryover-wave1, chưa lên master):** S3-FE-LEAVE-5 (#90) · S2-FE-AUTH-6 (#91) · S2-FND-DOC-1 (#92) · S2-AUTH-BE-8 (#93) · S2-AUTH-BE-9 (#95, resolve conflict với BE-8 giữ cả revoke+emit) · S2-AUTH-DOC-1 (#96) · S2-AUTH-BE-10 (#97) · S2-FE-FND-7 (#98) · S2-FND-BE-4 (#99). Việc kế: PR gộp `feat/carryover-wave1` → `master` (đi qua branch protection + review người).
- **Owner ĐÃ CHỐT + ĐÃ ÁP DỤNG (không còn pending):** (1) data_scope 'Project' = pin project-membership → D-22 DECISIONS-01 + DB-02 §4.7 (merged #96). (2) SENSITIVE_CAPABILITY_ALLOWLIST thêm 3 cặp export:leave · view:leave-audit-log · view:attendance-audit-log → WO mới S2-AUTH-CAP-1 (đã seed backlog, wave-1c đang chạy). (3) S2-FND-SEED-2 semantics: PATCH /hr/employee-code SYNC config→counter cùng tx, giữ current_value → bake vào re-run v3 wave-1c.
- **Pattern hiệu quả:** plan-block của plan-reviewer → bake nguyên văn điểm BLOCKING vào done_when qua args re-run (KHÔNG cần sửa backlog literal giữa wave). S3-FE-LEAVE-6 còn chờ S2-AUTH-CAP-1 merge rồi re-run (worktree ../mediaos-s3-fe-leave-6 đã sync base fdbcd36).
- **Bẫy lặp lại:** ship-agent fallback cắt branch từ wip HEAD → PR phồng + PR lạc base (#94 đã đóng) — xem memory harness-deploygate-pr-base (đã cập nhật cách cứu cherry-pick).

## Quyết định người-chốt chờ áp dụng (2026-07-02, session 1849d064) — auto-loop live nên CHƯA kịp bake vào retry đang chạy

- **S2-HR-BE-6** (Employee contracts): (1) GIỮ kỳ vọng ban đầu — seed grant RIÊNG Own cho employee + Team cho manager (không đổi QA-05 thành Company-only như plan-reviewer đề xuất phương án b). (2) Ngưỡng cảnh báo sắp hết hạn HĐ = company-configurable, mặc định 2 mốc: 30 ngày và 7 ngày (không phải 1 số cố định). ⚠️ Auto-loop đã retry S2-HR-BE-6 LẦN 2 (block khác: audit object_type 'employee_contract' thiếu trong AUDIT_OBJECT_TYPES/CHECK + permission pair chưa pin) — 2 quyết định trên CHƯA được bake vào round đó vì loop chạy live không có kênh inject giữa chừng. Áp dụng khi WO này tới điểm dừng (needs_human hoặc round kế).
- **S3-ATT-BE-5** (ATT Remote/Onsite): trạng thái khởi tạo = **Draft** (không phải default Pending hiện tại của bảng), cần action **submit** riêng (Draft→Pending) trong contract/API. Khi submit: người tạo chọn người duyệt trực tiếp HOẶC người duyệt thay thế, + danh sách người theo dõi (watcher) để nhận thông báo liên quan. Đây là thay đổi so với plan hiện có ở `docs/plans/S3-ATT-BE-5.md` (đang giả định create→Pending luôn, không có bước submit/watcher). WO chưa được auto-loop chạm lại trong phiên này — áp dụng khi pick up.
- **S2-AUTH-BE-7** (Session management API): CHỐT — KHÔNG seed permission pair riêng. Route GET/revoke sessions chỉ cần `Authenticated + owner-check` ở service layer (session.user_id === caller), giống pattern `/auth/me` + `/account/change-password` — không có phạm vi cross-user cần gate nên permission pair sẽ thừa. Route KHÔNG dùng `@RequirePermission`/`PermissionGuard` cho các endpoint self-service này.

## Phiên gần nhất (2026-06-20) — WAVE 2a fan-out 2 lane → merged master `2c1ac49`

- **Đã xong (Wave 2a, 2 lane song song)**:
  - **AUTH-FIX-1** (`67e7f2f`, 🔴 red→human-chốt): allow-list fail-closed `status==='active'` chặn CẢ 3 đường cấp token (login sau password.verify; refresh thu hồi family; **2FA step-2 — đường thứ 3 ask gốc bỏ sót**). 401 đồng nhất anti status-probing, reason chỉ vào audit_logs, không migration. Chạy qua **workflow** (Opus+plan+reviewer ĐỘC LẬP chạy ĐÚNG lần đầu nhờ fix pickReviewers — verdict LOW non-blocking). Verify: spec 10/10 + full api 2758 pass/0 fail.
  - **ACCT-2-FE** (`2c1ac49`, 🟡): UsersPage (TanStack Table + filter q/status + pagination + loading/error/empty) + suspend/delete/invite dialog; gating useCan/PermissionGate bằng hằng (manage/suspend/delete-user/invite:user); reuse `consoleInvitesApi` cho mời; api-client validate Zod. Verify master (web-core+ui rebuild): console **173/173** + typecheck OK.
  - Merge: FF authfix1 → rebase+FF acct2fe (khác vùng file, 0 conflict). Backlog: AUTH-FIX-1 + ACCT-2-FE = done.
- **Việc kế (Wave 2b)**: `PERM-UI-1` (③ phân quyền, crown — READY). Sau: `APP-MERGE-1` (cần PERM-UI-1). Solo: `TRIM-1`.
- **⚠️ Main tree đang GIỮA cuộc reframe lớn "de-media-fy" (83 file dirty, ADR 0022 mới, docs/spec/)** — diễn ra song song trong phiên, KHÔNG phải của lane agent. Harness bookkeeping Wave 2a (backlog status + STATUS regen + drop-lane fix `parallel-lanes.mjs`) CHƯA commit để tránh cuốn lẫn reframe → để owner commit cùng reframe HOẶC commit surgical theo lệnh.

## Friction / DEBT

1. ✅ **ĐÃ FIX (commit `3347358`)** — Reviewer ecc:* không tồn tại. `pickReviewers` giờ map vai-trò→agent CÓ THẬT (DB→rls-tenant-isolation-tester · security/silent-failure→general-purpose · react/typescript→completion-evaluator), gom theo agent (đa góc nhìn, không spawn trùng); reviewPrompt ép read-only mạnh hơn. Verified bằng dryRun. (Skills `ecc:santa-method`/`quality-gate` + build-resolver `ecc:*` vẫn là prompt-text, KHÔNG spawn nên không crash — để sau nếu cần.)
2. ✅ **ĐÃ FIX (Wave 2a, `parallel-lanes.mjs` CHƯA commit — xem cảnh báo reframe)** — workflow drop lane âm thầm khi stage1 (plan) trả `null` (lane skipPlan/non-crown): CONSOLE-1 ×2 + acct2fe (lần 3). Root-cause: pipeline drop item khi 1 stage trả falsy. Fix: stage1 trả sentinel `{__noPlan}` thay null (giữ item sống tới Implement), stage2 quy đổi sentinel→null cho prompt. Crown không ảnh hưởng (luôn có plan thật). Validate syntax OK (async-IIFE wrap). acct2fe Wave 2a dính bug TRƯỚC khi vá → cứu bằng Agent-tool workaround.
3. **Review agent `general-purpose` vượt quyền read-only**: đã Edit file acct2 dù dặn read-only (có quyền Edit). → dùng agent read-only (`Explore`/`rls-tenant-isolation-tester`) cho review, hoặc ràng buộc tool.
4. **DEBT — acct2 repo hardening CHƯA áp** (reviewer đề xuất, đã discard vì chưa review): thay `.select()`/`.returning()` → tập cột tường minh `ADMIN_USER_COLUMNS` + type `AdminUserRow` trong `admin-users.repository.ts` (+ chỉnh `service.ts`/`service.spec.ts`) → repo KHÔNG fetch `password_hash` (defense-in-depth #3). Master hiện dùng `select()`+toDto-strip — ĐÃ verify an toàn (test chứng minh không rò), nên đây chỉ là tăng cường. ~15', cần re-verify.
5. **AUTH-FIX-1** (backlog, red, sau ACCT-2): login chỉ lọc `deleted_at`, CHƯA chặn `status='suspended'` → user suspend vẫn đăng nhập (`auth.service.ts:302-306`).
6. baseline lint/typecheck ĐỎ (`@mediaos/api#lint`, `@mediaos/mobile#typecheck`) ⇒ Stop-gate `advisory`; dọn xanh rồi đổi `MODE='block'`.

## Bẫy đã biết (vận hành multi-lane)

- **Worktree mới**: cần `pnpm install` (chưa có node_modules) + build deps (`contracts/web-core/ui`) trước typecheck/test. Thiếu `.secrets/local-kek.bin` (gitignored) → 29 test crypto/2FA fail giả; main tree có sẵn, worktree mới phải regenerate.
- **DB cô lập**: verify trên DB lane riêng (`bash scripts/lane-db-setup.sh <lane>` + `export LANE_DB=mediaos_<lane>`), KHÔNG dùng `mediaos` chung (drift §9.6).
- **Xoá worktree trên Windows**: `git worktree remove` fail "Directory not empty" do node_modules → dùng `rm -rf <dir>` rồi `git worktree prune` + `git branch -d lane/*`.
- **Band migration**: lane v2 (acct2/ai1/console1) branch không khớp regex `g*`/`ac*` → `guard-migration-band` fail-open (không ép band); chỉ an toàn khi mỗi wave ≤1 lane sinh migration.

## Lịch sử

- Phiên 2026-06-19: FE-AUTH-1 (redesign login + 2FA) + ACCT-1 (self-service đổi mật khẩu/hồ sơ, wire route /settings/account) — đều land. Realign backlog v2 (auth·console·app).
- Phiên HARNESS-SPINE: dựng harness — backlog.mjs · gen-status.mjs · check.sh · init/finish.sh · handoff/policy/README · guard-scope (warn-only) · AGENTS.md.
