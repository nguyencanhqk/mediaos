# Bàn giao phiên — Memory tầng 2 (phiên trước → phiên sau)

> `harness/finish.sh` nhắc ghi vào đây cuối phiên; `harness/init.sh` đọc đầu phiên.
> Ghi NGẮN gọn. Cũ đẩy xuống "Lịch sử". Quyết định kiến trúc → ghi ADR (`docs/adr/`), không nhồi vào đây.
> Ô **Friction**: ghi cái gì làm tay/khó lặp lại — cùng một friction xuất hiện **≥2 lần** ⇒ gọi skill `skill-smith` để đóng băng thành skill.

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
