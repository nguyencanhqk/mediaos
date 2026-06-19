# Bàn giao phiên — Memory tầng 2 (phiên trước → phiên sau)

> `harness/finish.sh` nhắc ghi vào đây cuối phiên; `harness/init.sh` đọc đầu phiên.
> Ghi NGẮN gọn. Cũ đẩy xuống "Lịch sử". Quyết định kiến trúc → ghi ADR (`docs/adr/`), không nhồi vào đây.
> Ô **Friction**: ghi cái gì làm tay/khó lặp lại — cùng một friction xuất hiện **≥2 lần** ⇒ gọi skill `skill-smith` để đóng băng thành skill.

## Phiên gần nhất

- **Đang làm**: `FE-AUTH-1` — ① redesign apps/auth UX (login + 2FA). WIP đã có trong cây (chưa commit): `apps/auth/src/lib/brand.ts` · `SignalBar.tsx` · `index.css` gradient · `login.tsx` · `auth.service` change-pw · `apps/api/src/users` (scaffold ②a).
- **Đã xong lượt này**: ① realign backlog v2 (owner 2026-06-19) — thay `FE-WS-1..4` bằng chuỗi 3-app `auth·console·app`: `FE-AUTH-1`→`ACCT-1`→`ACCT-2`→`PERM-UI-1`→`CONSOLE-1`→`APP-MERGE-1`; đóng `HARNESS-SPINE`=done. ② **`ACCT-1`=done**: BE+FE đã có sẵn; gap THẬT = wire route `/settings/account` + nav item (`AccountSettingsPage` import-nhưng-không-dùng → không tới được) — đã vá ở `apps/console/src/router.tsx` + `lib/nav.ts` + nav label `myAccount` (web-core). int-spec 4/4 (lane `mediaos_acct`), FE `account.spec` 8/8, security review PASS.
- **Đang dở / việc kế**: (a) chốt `FE-AUTH-1` — cần **duyệt mắt** login redesign (machine done_when đã xanh: login.spec + typecheck); (b) mở `ACCT-2` (admin user CRUD/suspend/soft-delete + FE user-management).
- **Bẫy đã biết**: workflow script (parallel-lanes) KHÔNG đọc được file đĩa → bộ não giữ ở Workflow tool, spine là script thường; người/main-loop nối hai cái. · int-spec trên DB DÙNG CHUNG `mediaos` ĐỎ ở afterAll (`task_labels` thiếu — shared-DB drift §9.6) → verify auth/account PHẢI dùng lane DB (`bash scripts/lane-db-setup.sh acct`).
- **Friction / DEBT**: (1) baseline lint/typecheck ĐỎ (`@mediaos/api#lint`, `@mediaos/mobile#typecheck`) ⇒ Stop-gate `advisory`; dọn xanh rồi đổi `MODE='block'` trong `.claude/hooks/stop-gate.mjs`. (2) **M1 (MEDIUM, bounded)**: `POST /auth/change-password` thừa hưởng `@AllowWithoutTwoFactor()` cấp controller → user bị ép-2FA-chưa-enroll vẫn đổi được mật khẩu (vẫn cần re-auth mật khẩu cũ nên KHÔNG phải bypass credential; chỉ defense-in-depth). Cân nhắc tách route hoặc guard per-route khi đụng 2FA enforcement.

## Lịch sử

- Phiên HARNESS-SPINE: dựng harness — backlog.mjs · gen-status.mjs · check.sh · init/finish.sh · handoff/policy/README · guard-scope (warn-only) · AGENTS.md.
