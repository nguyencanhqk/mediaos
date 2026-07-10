# S4-TASK-SEED-1 — Seed permission TASK (23 mã canonical) + role-permission mapping

> **Bản viết lại 2026-07-10 (rev 2 — sau plan-reviewer REVISE)** — thay thế toàn bộ plan cũ (sinh
> 2026-07-09 trên feat/ready-wave3, TRƯỚC khi owner chốt done_when mới + trước khi S4-TASK-RECON-1
> chiếm band 0480). Khác plan cũ: (1) BỎ cặp `checklist`; (2) migration = **0485**; (3) thêm bước
> **UPDATE is_sensitive**; (4) allowlist xử lý NGAY trong WO; (5) rev 2: ma trận truy nguyên từng hàng
> về SPEC-06 §9 (không nội suy mù), TRIM `file-delete:task` khỏi employee, verify đếm theo tập 23 cặp
> canonical (không theo resource_type), đã pre-check drift prod/dev bằng query thật.

```yaml
wo: S4-TASK-SEED-1
zone: red            # crown: permission seed + migration → FULL gate
generated_by: hand-authored (Fable solo session 2026-07-10)
head_at_planning: 0484_s4_dashseed1_widget_catalog_perms (idx 164, when 1717500815000)
migration: 0485_s4_taskseed1_task_perms.sql   # idx 165, when 1717500820000 (+5000)
gate: FULL           # security-reviewer + database-reviewer
lane_db: mediaos_taskseed   # bash scripts/lane-db-setup.sh taskseed
```

## 1. Nguồn sự thật

- **Catalog 23 mã**: DB-06 §12.1 (`docs/DB/DB-06 TASK Database Design.md:1972`) — 8 project + 14 task + 1 audit. **OWNER CHỐT 2026-07-09: ĐÚNG 23, KHÔNG hơn.**
  - ⚠️ SPEC-06 §8.2 (TK-1, "chuẩn = API-06 §8") liệt kê **25 mã** — thêm `TASK.PROJECT.FILE_UPLOAD/FILE_DELETE`. Hai cặp project-file này **CỐ Ý KHÔNG seed** ở WO này (owner chốt bám DB-06 §12.1). Nếu S4-TASK-BE-* cần endpoint file cấp dự án → cần owner quyết + WO seed bổ sung (ghi đích danh trong PR body).
- **Ma trận role×chức năng CHI TIẾT**: SPEC-06 §9 (`docs/spec/SPEC-06 TASK.md:524-543`) — nguồn gốc; `docs/permission-matrix-spec.md` §6 chỉ là roll-up (thiếu dòng "Cập nhật task").
- **Scope theo role**: DB-06 §12.2 + SPEC-06 §8.3 + owner chốt: Employee=Own · Manager=Team · HR/Admin=Company.
- **is_sensitive**: owner chốt: TRUE = `delete/close/archive/manage-member/view-report:project` + `delete/export:task` + `view:task-audit-log` (8 cặp). Còn lại (15) FALSE.
- **Khuôn migration**: 0454 (DO-block ARRAY grants + RAISE resolve-fail) · 0476 (UPDATE is_sensitive false→true idempotent) · 0480 (per-pair DELETE-wrong-scope + INSERT, KHÔNG blanket). Verify exact-set (§4d) là pattern MỚI mạnh hơn 0454/0480 (hai mig đó chỉ RAISE khi resolve-fail) — chủ đích, xem §4.
- **Khuôn int-spec**: `apps/api/src/attendance/att-permissions-seed.int.spec.ts` (MATRIX-driven, gate `hasDb && LANE_DB`).
- **Hiện trạng grants**:
  - Sau 0480 (chuỗi migration sạch): company-admin = 10 cặp family (`{create,read,update,delete,assign,comment}:task ∪ {create,read,update,delete}:project`) · employee = `{read,comment}:task` (read @**Company** — default 0441; comment @Own) · manager = hr = ∅. Legacy ngoài family: `comment:comment` (RECON-2 gỡ), catalog `submit/manage:task`, `manage/assign:project`.
  - **Pre-check DB THẬT 2026-07-10** (query trực tiếp `mediaos` + `mediaos_dev`): cả hai còn ở trạng thái TRƯỚC 0480 (admin còn submit/manage:task+manage/assign:project, employee còn submit:task, chưa có comment:task) — đúng nguyên trạng 0005+0441, **KHÔNG có drift runtime** (rule-builder chưa đụng TASK trên system role). Khi migrate, 0480 chạy TRƯỚC 0485 trong cùng lượt → verify 0485 gặp state hội tụ. Role media parked (channel-manager/project-manager/editor/qa-reviewer/script-writer/uploader/hr-manager) giữ grant TASK-family riêng — NGOÀI phạm vi (verify chỉ soi 4 role canonical).
- **Super Admin**: KHÔNG seed. `super-admin-bootstrap.repository.ts:127` load TOÀN BỘ catalog (kể cả sensitive, trừ break-glass) grant @System idempotent MỖI lần boot → 13 cặp mới tự phủ ở lần khởi động kế.

## 2. Catalog — 23 cặp engine (action, resource_type) + is_sensitive

| resource | action | is_sensitive | tồn tại? |
|---|---|---|---|
| project | read / create / update | false | ĐÃ có (0005) |
| project | delete | **true** | ĐÃ có (0005, đang false → **UPDATE**) |
| project | close / archive / manage-member / view-report | **true** | MỚI |
| task | read / create / update / assign / comment | false | ĐÃ có (0005/0480) |
| task | delete | **true** | ĐÃ có (0005, đang false → **UPDATE**) |
| task | watch / view-kanban / update-status / update-priority / update-deadline / file-upload / file-delete | false | MỚI |
| task | export | **true** | MỚI |
| task-audit-log | view | **true** | MỚI |

- INSERT 13 cặp mới `ON CONFLICT (action, resource_type) DO NOTHING` (hot-file UNION).
- `UPDATE permissions SET is_sensitive=true WHERE (action,resource_type) IN (8 cặp) AND is_sensitive=false` — idempotent, mirror 0476(b). Bắt buộc vì `delete:project`/`delete:task` tồn tại false từ 0005.
- `read:project`/`read:task` PHẢI giữ false (cổng nav FE). KHÔNG UPDATE ngoài danh sách 8.
- resource audit = `task-audit-log` DISTINCT (mirror attendance/leave-audit-log — không over-grant generic `audit-log`).
- KHÔNG đụng catalog legacy (`submit/manage:task`, `manage/assign:project`, `comment:comment`).

## 3. Ma trận grant per-(role, pair) — 67 hàng seed ở 0485 + 5 hàng HOÃN, TRUY NGUYÊN từng hàng

Nguồn: SPEC-06 §9 (dòng trích bên phải). `—` = KHÔNG grant. `⏸` = HOÃN sang S4-TASK-BE-2 (footnote ⁷ + §7). Employee=Own · Manager=Team · HR/Admin=Company.

| pair | emp | mgr | hr | admin | nguồn SPEC-06 §9 |
|---|---|---|---|---|---|
| read:project | **Own** | Team | Company | Company | :528 "Xem DS dự án — EMP nếu là member" |
| create:project | — | Team | Company | Company | :529 "Tạo dự án — EMP: Không mặc định" |
| update:project | — | Team | Company | Company | :530 "Cập nhật dự án — MGR: dự án quản lý" |
| close:project | — | Team¹ | — | Company | :531 "Đóng/hủy — HR: Không mặc định · MGR: nếu owner" |
| archive:project | — | Team¹ | — | Company | :531 nhóm đóng/hủy/lưu trữ (TASK-FUNC-004) |
| delete:project | — | Team¹ | — | Company | :531 + FUNC-004 "Đóng/hủy/**xóa mềm** dự án"² |
| manage-member:project | — | Team¹ | — | Company | :532 "QL thành viên — HR: Không mặc định · MGR: nếu owner" |
| view-report:project | — | Team | Company | Company | :541 "Xem báo cáo — HR: Có nếu được cấp" |
| read:task | **Own** | Team | Company | Company | :533 "EMP: chỉ task liên quan" |
| create:task | ⏸Own⁷ | ⏸Team⁷ | Company | Company | :534 "EMP: Có nếu được cấp" |
| update:task | ⏸Own⁷ | ⏸Team⁷ | Company | Company | :536 "EMP: **Có giới hạn với task của mình**" |
| update-status:task | Own | Team | Company | Company | :537 "EMP: có nếu là assignee" |
| comment:task | Own | Team | Company | Company | :538 "có nếu xem được task" (mọi role) |
| file-upload:task | Own | Team | Company | Company | :539 "Upload file — EMP: Có nếu được cấp" |
| file-delete:task | **—**³ | Team | Company | Company | KHÔNG có dòng §9 → trim EMP (least-privilege) |
| watch:task | Own⁴ | Team | Company | Company | §6.7 watcher + §12.3(5) + Own gồm "theo dõi" (§8.3:505) |
| view-kanban:task | Own⁴ | Team | Company | Company | FUNC-013 + §6.8 (view-mode trên task đã thấy được) |
| assign:task | — | Team | Company | Company | :535 "Giao task — EMP: Không mặc định" |
| update-priority:task | — | Team | Company | Company | không dòng riêng → nhóm hành-động-quản-lý (mirror assign)⁵ |
| update-deadline:task | — | Team | Company | Company | như trên⁵ |
| delete:task | — | ⏸Team¹⁷ | — | Company | :540 "Xóa task — HR: Không mặc định · MGR: creator/owner" |
| export:task | — | Team | Company | Company | :542 "Xuất task — EMP: Không mặc định" |
| view:task-audit-log | — | — | Company⁶ | Company | tiền lệ ATT/LEAVE (0454:211-212, 0455) — hr+admin |

¹ "Nếu owner/creator" = owner-check per-project ở BE (S4-TASK-BE-1, qua `project_members`) — seed chỉ cấp capability @Team.
² `delete:project` cho manager = nội suy từ FUNC-004 (nhóm đóng/hủy/xóa mềm cùng hàng ma trận); owner deny-list im lặng về manager → giữ, **flag cho owner + security-reviewer**.
³ Trim `file-delete:task` khỏi employee: không nguồn nào cấp (SPEC-06 §9 không có dòng xóa file; employee vẫn upload được). Cấp lại sau = 1 migration additive rẻ.
⁴ `watch`/`view-kanban` employee = suy diễn chức năng (không dòng §9): watcher là visibility-source (§12.3 đk 5), Own-scope định nghĩa gồm "được giao **hoặc theo dõi**"; kanban là view-mode trên tập task đã được scope. Non-sensitive, không mở dữ liệu mới. **Flag cho owner**.
⁵ `update-priority/update-deadline` không có dòng §9 riêng → xếp nhóm quản-lý (ai giao việc thì chỉnh ưu tiên/deadline); employee bị TRIM dù có update:task (deadline/priority do người giao đặt). **Flag cho owner**.
⁶ hr `view:task-audit-log` @Company = mirror đích danh 0454 (`view:attendance-audit-log` hr+admin) + 0455 (leave) — owner deny-list hr KHÔNG cấm. **Flag cho owner**.
⁷ **HOÃN sang S4-TASK-BE-2** (plan-reviewer BLOCK 2026-07-10, chọn nhánh fail-closed (B)): 5 grant write/destructive NET-NEW cho role scope-đích < Company trên route sống pair-only — chi tiết §7. BE-2 grant trong migration CÙNG release với enforcement scope+membership, đồng thời lật 5 assert DENY tương ứng trong task-permissions-seed.int.spec.ts (khuôn RECON-2). Danh sách máy-đọc: `TASK_DEFERRED_GRANTS` (task-permissions.const.ts).

**Đếm SEED Ở 0485**: employee **7** · manager **19** · hr **18** · company-admin **23** = **67 hàng** (+5 hoãn = 72 đích cuối sau BE-2).

Khớp done_when deny: employee KHÔNG create/update/delete/close/archive:project ✓ · hr KHÔNG close/delete/archive/manage-member:project + delete:task ✓ · admin đủ 23 ✓.

**Re-scope thật sự**: `employee read:task` @Company (0441 default, đã xác nhận trên DB thật) → DELETE đúng bộ + INSERT @Own. Behavior change CÓ CHỦ ĐÍCH (least-privilege §9:533). Grant ALLOW liên tục — không có cửa sổ 403.

## 4. Migration 0485 — cấu trúc

1. **(a) Catalog**: INSERT 23 cặp (is_sensitive theo §2) `ON CONFLICT DO NOTHING`.
2. **(b) Nâng is_sensitive**: UPDATE 8 cặp WHERE `is_sensitive=false` (idempotent — mirror 0476).
3. **(c) Grants**: DO-block `ARRAY[role, action, resource, scope]` **67 hàng** (72 ma trận − 5 hoãn ⁷) — mirror 0480/0454: resolve role (`company_id IS NULL AND deleted_at IS NULL`) + permission → **RAISE nếu thiếu**; per-pair `DELETE … data_scope <> target` (KHÔNG blanket); `INSERT … ON CONFLICT (role_id, permission_id, effect) DO NOTHING`.
4. **(d) Verify fail-LOUD (pattern MỚI, mạnh hơn 0454)**: giới hạn vào **4 role canonical × tập 23 cặp canonical tường minh** (permission_id resolve từ 23 cặp — KHÔNG đếm theo resource_type, miễn nhiễm legacy `submit/manage:task`/`comment:comment`/role media parked):
   - từng hàng trong 67: tồn tại đúng scope (bảo đảm cấu trúc bởi (c): DELETE-wrong-scope + INSERT + UNIQUE cho phép đúng 1 hàng ALLOW) + probe crux employee read:task='Own';
   - đếm grant của mỗi role canonical TRÊN TẬP 23 cặp == **7/19/18/23** — RAISE nếu dư (over-grant);
   - 8 cặp sensitive `is_sensitive=true`; `read:task`/`read:project` = false — RAISE nếu sai.
   An toàn abort-prod: đã pre-check DB thật (§1) — không drift; chuỗi migrate luôn 0480→0485 cùng lượt.
5. **KHÔNG**: DDL/RLS/FORCE (thuần data — bất biến #1 giữ) · seed super-admin (bootstrap tự phủ, §1) · re-active module task · đụng `comment:comment`/grant role media parked (RECON-2 + park giữ nguyên).
6. Journal: idx 165, when 1717500820000 — nối tiếp ĐƠN ĐIỆU sau 0484. Trước commit: kiểm `git worktree list` + `node harness/claim.mjs list` chống lane song song mint trùng band.

## 5. SENSITIVE_CAPABILITY_ALLOWLIST — APPEND NGAY trong WO

done_when #5 yêu cầu "admin thấy đủ 23 cặp qua /auth/me". `/auth/me` capabilities = getCapabilities (lọc BỎ sensitive) + `getAllowlistedSensitiveCapabilities` → không append thì 8 cặp sensitive vắng với CẢ admin (bug CAP-2). ⇒ chọn nhánh "PHẢI append" của done_when #6.

- APPEND-only 8 key vào `SENSITIVE_CAPABILITY_ALLOWLIST` (`apps/api/src/permission/permission.service.ts:43`): `delete:project` · `close:project` · `archive:project` · `manage-member:project` · `view-report:project` · `delete:task` · `export:task` · `view:task-audit-log`.
- Chỉ mở CỜ HIỂN THỊ (grant-bound + DENY-override giữ) — enforcement KHÔNG đổi. Wildcard `*:*` không kế thừa.
- Manager surface các cặp sensitive @Team được grant — đúng grant-bound; owner-check per-project là việc BE.
- **Mở rộng paths WO** trong backlog: + `apps/api/src/permission/**` + `apps/api/src/auth/**` (giữ FULL gate, tránh guard-scope cảnh báo sai).

## 6. Test — RED trước, gate `hasDb && LANE_DB`

1. `apps/api/src/foundation/seed/task-permissions.const.ts` — TASK_PERMISSIONS (23 cặp + is_sensitive) + TASK_GRANT_MATRIX (67 hàng) + TASK_DEFERRED_GRANTS (5 hàng hoãn) — mirror attendance-permissions.const.
2. `apps/api/src/foundation/seed/task-permissions-seed.int.spec.ts` — mirror att-permissions-seed:
   - (A) catalog đủ 23 cặp, is_sensitive EXACT (delete:project/delete:task=true chứng minh UPDATE chạy; read:*=false);
   - (B) grant per-(role,pair) scope EXACT 67 hàng — đặc biệt `employee read:task === 'Own'` (chứng minh re-scope);
   - (C) DENY holes theo cặp cụ thể (không chỉ đếm): employee KHÔNG hàng ALLOW (bất kể scope) cho create/update/delete/close/archive/manage-member/view-report:project + assign/delete/export/update-priority/update-deadline/file-delete:task + view:task-audit-log; hr KHÔNG close/delete/archive/manage-member:project + delete:task; manager KHÔNG view:task-audit-log; **+ 5 grant hoãn PHẢI vắng** (employee create/update:task, manager create/update/delete:task — BE-2 lật); đếm EXACT trên tập 23 cặp per role (7/19/18/23);
   - (D) idempotent: chạy lại toàn bộ SQL 0485 lần 2 → row count không đổi, không duplicate;
   - (E) catalog legacy không nhân đôi (submit:task… đúng 1 row). KHÔNG assert grant `comment:comment` (đã thuộc task-recon-grants.int-spec (c') — RECON-2 sẽ lật; tránh coupling thứ tự).
3. `apps/api/src/auth/auth-me-capabilities.int.spec.ts` — APPEND block TASK (mirror CAP-1/CAP-2): admin /auth/me đủ 23 key === true; hr CÓ view-report:project/export:task/view:task-audit-log, KHÔNG close/delete/archive/manage-member:project + delete:task; employee KHÔNG key sensitive nào + KHÔNG create:project; wildcard-only KHÔNG kế thừa sensitive.

Trình tự: spec trước → chạy trên lane DB migrate tới 0484 = **RED** → viết 0485 + allowlist → migrate → **GREEN** → re-run idempotent. Lane: `bash scripts/lane-db-setup.sh taskseed` + `LANE_DB=mediaos_taskseed`; migration-smoke clean 0000→0485.

## 7. Rủi ro & chốt chặn

- **KHÔNG phải "expand-only tuyệt đối"**: WO này = expand (13 catalog + ~57 grant mới) **+ 1 re-scope thu hẹp chủ đích** (employee read:task Company→Own) + nâng is_sensitive 2 cặp. Không revoke cặp nào → không cửa sổ 403.
- **Route sống pair-only — INVENTORY ĐẦY ĐỦ (đã quét toàn bộ @RequirePermission trong apps/api/src/tasks 2026-07-10)**: cặp canonical có consumer sống = `read:task` (GET board/by-project/by-team + attachments list/download) · `create:task` (POST /tasks) · `update:task` (PATCH /tasks/:id + /status + labels add/remove) · `delete:task` (DELETE /tasks/:id + DELETE attachment) · `comment:task` (POST comments). KHÔNG route sống nào tiêu thụ cặp `project`/`task-audit-log`/`assign`/`export`/`update-status`/`watch`/`view-kanban`/`update-priority`/`update-deadline`/`file-*` (label/project_state của 0420 ngoài tập canonical). `tasks.service` KHÔNG check creator/assignee/membership trên actor; KHÔNG dùng DataScopeService.
- **Xử lý escalation (plan-reviewer BLOCK → chọn nhánh (B) fail-closed)**:
  - **HOÃN 5 grant** (write/destructive net-new × scope-đích < Company × route sống): employee `create:task`/`update:task` @Own · manager `create:task`/`update:task`/`delete:task` @Team → S4-TASK-BE-2 grant CÙNG release với enforcement scope+membership. Employee/manager hôm nay 403 trên các route đó → **GIỮ 403** (không escalation, không regression). `TASK_DEFERRED_GRANTS` trong const là danh sách bàn giao máy-đọc; 5 assert DENY trong int-spec khóa trạng thái (BE-2 lật, khuôn RECON-2).
  - **GIỮ + disclose**: (i) manager `read:task` @Team = net-new READ trên route sống → manager tạm đọc task toàn công ty tới khi BE enforce — CÙNG LỚP đã-chấp-nhận với employee read:task @Company tồn tại từ 0005 (và cũng chính là lý do re-scope read của employee là no-op runtime hôm nay); non-destructive; (ii) manager/hr `comment:task` = net-new comment (low-harm, mirror chấp nhận của RECON-1); (iii) hr `create:task`/`update:task` @Company = scope-đích TRÙNG hành vi route → KHÔNG escalation (hr là role tin cậy cấp company theo ma trận).
  - **Control giảm nhẹ sẵn có**: mọi update/delete route ghi audit (TaskUpdated/soft-delete + actorUserId), task-FSM bảo vệ chuyển trạng thái, RLS giữ tenant; TASK FE chưa tồn tại → exposure = API trực tiếp nội bộ.
  - **Bàn giao BE-1/BE-2 (nêu đích danh)**: route project mới của BE-1 PHẢI kèm owner-check per-project (không lặp lỗi pair-only); BE-2 áp scope+membership trên task CRUD rồi grant 5 hàng hoãn cùng release.
- **Nâng is_sensitive delete:task/delete:project ↔ route sống**: `DELETE /tasks/:id` (tasks.controller:155) đang gate `delete:task`; company-admin GIỮ grant (0005) và guard per-resource đọc catalog runtime → sau nâng sensitive, `can()` yêu cầu grant trực-tiếp non-wildcard — admin có grant trực tiếp ⇒ vẫn 2xx, wildcard-holder mất (đúng thiết kế sensitive-gate, mirror 0476 nâng delete:user). Không cửa sổ 403 cho role canonical.
- **Exact-verify nổ trên drift**: đã pre-query prod+dev (§1) = sạch. Nếu tương lai owner cấp tay cặp canonical cho role canonical ngoài ma trận → RAISE là hành vi ĐÚNG (lộ drift, không nuốt).
- **RECON-2 ordering**: RECON-2 chạy RELEASE SAU (prerequisite: code gate comment:task ổn định). Nếu vì lý do nào đó RECON-2 land trước SEED-1: band 0485 phải dời theo head thật lúc commit; spec §6 không assert comment:comment nên không vỡ.
- **FE pair-drift (S4-FE-TASK-1/2/3, nêu đích danh)**: PERMISSION_CODE_TO_PAIR ở web-core phải map đúng hyphen-case: `manage-member/view-report:project`, `view-kanban/update-status/update-priority/update-deadline/file-upload/file-delete:task`, `view:task-audit-log` (bài học PR #59).
- PM (Project Manager) = vai trò cấp-dự-án (`project_members.role`), KHÔNG phải system role — không seed. Super Admin = bootstrap (§1).
- Prod/dev-online hiện pre-0480 → lượt migrate kế áp 0480+0481+0482+0483+0484+0485 liên tục; nhắc vận hành trong PR body (`m dev-online-db`).

## 8. Definition of Done (map done_when)

- [ ] 0485 catalog đúng 23 mã, KHÔNG hơn (không checklist; không 2 cặp project-file của TK-1) — done_when #1
- [ ] UPDATE is_sensitive idempotent 8 cặp (gồm delete:project/delete:task false→true) — done_when #2
- [ ] Grant 67 hàng per-(role,pair) đúng scope + verify fail-LOUD exact-set (7/19/18/23); 5 hàng hoãn ghi debt máy-đọc TASK_DEFERRED_GRANTS + bàn giao BE-2 — done_when #3
- [ ] Re-scope employee read:task Company→Own qua DELETE+INSERT; KHÔNG re-seed module — done_when #4
- [ ] Deny-path RED-trước theo cặp cụ thể + admin đủ 23 cặp qua /auth/me — done_when #5
- [ ] Allowlist append 8 cặp sensitive (nhánh append, không debt) — done_when #6
- [ ] Gate hasDb && LANE_DB; idempotent re-run; FULL gate security-reviewer + database-reviewer PASS — done_when #7
