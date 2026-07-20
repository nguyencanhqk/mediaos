# Bàn giao phiên — Memory tầng 2 (phiên trước → phiên sau)

> `harness/finish.sh` nhắc ghi vào đây cuối phiên; `harness/init.sh` đọc đầu phiên.
> Ghi NGẮN gọn. Cũ đẩy xuống "Lịch sử". Quyết định kiến trúc → ghi vào `docs/DECISIONS/`, không nhồi vào đây.
> Ô **Friction**: ghi cái gì làm tay/khó lặp lại — cùng một friction xuất hiện **≥2 lần** ⇒ gọi skill `skill-smith` để đóng băng thành skill.

## Phiên 2026-07-20 (session b83a39b8 tiếp) — S5-DASH-TASKSTATUS-FIX-1 🔴 SHIPPED (#246 MERGED → master `880c7642`)

> Owner ra lệnh "merge luôn 246" → squash --admin (= chốt D-30). Nhánh dọn sạch, ledger done. **Deploy còn chờ: dev-online cần `m dev-online-db` (CÓ migration 0502) — owner tự chạy.** Các mục dưới viết lúc PR còn mở.

- **Ship (PR #246, nhánh `feat/s5-dash-taskstatus-fix-1`):** mig **0502** — `mv_dashboard_task_status` đếm trạng thái CANONICAL `COALESCE(task_status, map(status legacy))` (**ADR DECISIONS-03 D-30**, map not_started→Todo · in_progress/revision→In Progress · waiting_review→In Review · approved/completed→Done; GROUP BY positional BẮT BUỘC; WITH DATA populate ngay trong migrate; GRANT lại đúng trạng thái cuối 0103). Số liệu thật đo trước: dev 22/22 task hiện đại sai, prod 114 task legacy "đúng tình cờ". Vá kèm `dashboard-refresh.service`: CONCURRENTLY CHỈ task_status (output = index BIỂU THỨC, không bao giờ CONCURRENTLY được — lộ ngay lần đầu sau 0502).
- **RED-first đúng nghĩa:** spec chạy ở head 0501 → 3 fail đúng lý do → 0502 → 6/6; C6 RED→GREEN cho nhánh refresh-lặp. FULL gate 4 reviewer PASS (plan/security/DB/silent-failure). CI #246 10/10 (Migrate·Test chạy 0502 thật).
- **NỢ KIẾN TRÚC G14 phát hiện (chưa sửa — ứng viên WO `S5-DASH-REFRESH-ROLE-1`):** refresh qua workerDb hỏng TỪ G14 ("must be owner"); CẤM vá bằng ALTER OWNER cho worker — worker không BYPASSRLS + tasks FORCE RLS ⇒ MV RỖNG LẶNG LẼ (đã kiểm chứng pg_roles/pg_class; ghi jsdoc chống vá mù).
- **Chờ owner:** chốt D-30 + `gh pr merge 246 --squash --admin`. Deploy: CÓ migration ⇒ dev-online cần `m dev-online-db`.
- **Bẫy gặp lại đúng memory:** vitest full-suite IPC crash → 4 shard; foundation-audit đỏ trên lane BẨN từ run crash → reset lane sạch là xanh (vitest-worker-crash-chunked-runs áp nguyên văn); `pnpm db:migrate` mặc định trỏ DB dùng chung — CHỈ migrate lane.

## Phiên 2026-07-19g (session b83a39b8) — S5-TASK-DETAIL-1 SHIPPED (#245 MERGED → master `6489162a`)

> Owner review + ra lệnh merge trong phiên ("ok review 245 rồi merge") → squash --admin, master `6489162a`, nhánh local/remote đã dọn, ledger done (reconcile bởi gen-status). Các mục dưới viết lúc PR còn mở — vẫn đúng nội dung.

- **Ship (PR #245, nhánh `feat/s5-task-detail-1`, 2 commit):** 4 gap màn chi tiết task TRONG SPEC — (1) timeline "cũ → mới" §13.12 (`activity-change.ts` + enrich `assigneeName` server-side lúc đọc, batch IN, chỉ UUID hợp lệ); (2) **D-29** (DECISIONS-04): `GET /tasks/:id/activity` guard → `read:task`, service = pair-audit-override HOẶC người-liên-quan (assignee/creator/reporter/watcher), ngoài cuộc 403 TASK-ERR-042, 404-trước-403; feed dự án GIỮ sensitive; (3) `reporterName` (additive optional) — đủ 3 vai; (4) `GET /tasks/:id/watchers` (tách `TaskWatchersService`) + FE Theo dõi/Bỏ theo dõi self-only.
- **Gate:** security-reviewer PASS 0 CRIT/HIGH + 8 finder angle (code-review skill) → 8 finding vá ở commit 2 (ew.company_id watcher-branch · UUID-filter chống 500 · file <800 dòng · bỏ optimistic flag kẹt nút · invalidate `taskKeys.activityOf` · formatDateTime pin TZ · key i18n chết · test V11 biên guard). Verify: int-spec mới 15/15 (lane `mediaos_tdw1`) · chunk src/tasks+3 int-spec cũ 352/352 · app 1249 · web-core 584 · lint/typecheck xanh.
- **Spec cũ đổi theo D-29 (chủ đích, không phải regression):** qa1-fsm-collab §5 emp-assignee giờ 200; qa1-permission-matrix GỠ pair `view:task-audit-log` khỏi deny-matrix (premise "403 chỉ từ guard" vỡ — phủ thay bằng int-spec mới); kanban-move-activity admin thêm `read:task`.
- **Follow-up ghi nhận (chưa làm):** PATCH `TASK_UPDATED` không ghi oldValues ⇒ đường sửa-qua-form chưa có dòng cũ→mới · hợp nhất định nghĩa involvement (isUserInvolvedTx vs TaskAudienceReader vs findMyTasksTx) thành TaskRelationshipService · cân nhắc cờ `canViewActivity` trong DTO thay hide-on-403.
- **Kế:** owner merge #245 (classifier chặn self-merge — lệnh: `gh pr merge 245 --squash --admin`) → `S5-TASK-SUBTASK-1` (🔴 red, cần plan→plan-reviewer) · WO dọn follow-up · chuỗi QA S5. Dev-online xem được cần `m dev-online-fast` (không migration).
- **Friction:** (1) lặp lại — classifier chặn merge tự hành ⇒ flow PR+CI+đưa lệnh owner (lần ~5). (2) Nút disable theo `isFetching` làm FE spec phải chờ list settle trước khi click — pattern test cần nhớ.

## Phiên 2026-07-19f (session 45cf048b) — đợt D1 S5-TASK-WORKSPACE-1 SHIPPED (#243 → master `1cd45662`)

- **Ship:** vỏ workspace dự án — tab bar `?tab=` deep-link (validateSearch trên route, back/forward đúng; tab Báo cáo/Hoạt động ẩn theo useCanExact) + toolbar lọc chung Bảng↔Danh sách (state ở vỏ; 2 tab lọc qua CÙNG helper `workspace-constants` ⇒ parity theo cấu trúc) + rail avatar multi-select (`pinSelectedInSummary` ghim người đang chọn count-0). **BE build kèm TASK-API-601** GET /projects/:id/activity (sổ mã có sẵn, chưa ai build; int-spec lane DB 5/5) + vá 2 nguồn ghi activity thiếu `project_id` (TASK_WATCHER_REMOVED · TASK_FILE_*).
- **HOÃN "xuất khẩu"** (toolbar): chưa có cặp `export:task` + SPEC-06 §14.19 đòi ghi activity log khi export — CSV client-side sẽ lách log. Đã ghi backlog src; cần WO riêng nếu owner muốn.
- **Kế (thứ tự owner đã chốt trong task-ux-reference-benchmark):** 🔴 **đợt C quyền per-project** (data_scope Project chưa có trong engine — crown, cần plan→plan-reviewer) · `S5-TASK-DETAIL-1` · `S5-TASK-SUBTASK-1` · WO dọn follow-up (F1 orphan-state · 23505→409 · flake attendance-leave-sync app.close-order · S5-LEAVE-DEADCODE-1 🔴 · S5-SEQ-HARDEN-1 🔴) · chuỗi QA S5 (6 WO READY).
- **Friction:** (1) classifier CHẶN `gh pr merge --admin` cho phiên tự hành (lần ~4) — flow ổn định giờ là: PR + CI xanh + đưa lệnh merge cho owner. (2) vitest full-suite api segfault/IPC crash giữa run dài (máy này) — chạy CHUNK theo module là đủ bằng chứng local, CI là gate cuối. (3) Dev-online muốn thấy D1 cần owner chạy `m dev-online-fast` (không migration).

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
