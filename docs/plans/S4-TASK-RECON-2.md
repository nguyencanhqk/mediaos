```yaml
wo: S4-TASK-RECON-2
zone: red
generated_by: claude-manual (phiên solo tuần tự 2026-07-10)
base: origin/master 78643ee (PR #142)
lanes: [{"id":"contractMig","task":"[NỐI TIẾP · crown] Migration CONTRACT 0486 (idx 166, when 1717500825000 — nối tiếp head 0485/idx165/when 1717500820000, verify lại `tail -1 _journal.json` NGAY TRƯỚC khi tạo): PER-PAIR DELETE grant ('comment','comment') cho employee + company-admin (system role: company_id IS NULL, deleted_at IS NULL) — resolve role_id + permission_id trong DO-block, DELETE đúng bộ (role_id, permission_id, 'ALLOW'), TUYỆT ĐỐI KHÔNG blanket theo role_id (mirror 0444/0445/0480). THUẦN DATA, KHÔNG DDL, KHÔNG đụng catalog row ('comment','comment') — còn 7 role media legacy tham chiếu (đã query 2026-07-10). Idempotent: chạy lại = DELETE 0 row.","builder":"db-migration","paths":["apps/api/migrations/**"]},{"id":"contractVerify","task":"[cùng PR; RED-trước] Cập nhật apps/api/test/integration/task-recon-grants.int-spec.ts: (c') lật 'VẪN CÒN = 2' → 'đã contract = 0'; thêm ('comment','comment') vào FORBIDDEN_RESIDUAL; test (d) giữ nguyên (dùng submit:task); PHẦN 2 thêm HTTP company-admin POST comment 201 + user KHÔNG role POST comment 403 (deny-by-default tầng HTTP).","builder":"qa-test-engineer","paths":["apps/api/test/integration/**"]}]
acceptanceChecks: ["ĐIỀU KIỆN TIÊN QUYẾT đã verify (bằng chứng §1 dưới): grep \"'comment', *'comment'\" apps/api/src == 0; prod+dev-online đang chạy code gate ('comment','task'); 2 DB ở head 0485 với trạng thái transitional đúng (employee+company-admin giữ SONG SONG comment:task và comment:comment).","Migration 0486 THUẦN DATA (chỉ DELETE role_permissions), KHÔNG DDL, KHÔNG đụng RLS/FORCE/policy/grant 0005 (BẤT BIẾN #1); app role không có DELETE role_permissions runtime — migrator chạy DATABASE_DIRECT_URL (BẤT BIẾN #2).","PER-PAIR DELETE resolve role_id+permission_id trong DO-block; KHÔNG blanket theo role_id; role/permission thiếu → CONTINUE (không có gì để gỡ); RAISE NOTICE số row gỡ; chạy lại lần 2 = DELETE 0 row (idempotent).","Catalog row ('comment','comment') GIỮ NGUYÊN — 7 role media legacy (channel-manager·editor·hr-manager·project-manager·qa-reviewer·script-writer·uploader) còn grant tham chiếu (query 2026-07-10) → theo done_when: còn tham chiếu thì CHỈ gỡ grant. KHÔNG DELETE FROM permissions.","Int-spec: (c') n=0 cho employee+company-admin; FORBIDDEN_RESIDUAL gồm cả ('comment','comment') — không role canonical nào còn; (b) EXACT grant-set KHÔNG đổi (comment:comment resource 'comment' vốn ngoài tập task+project); (d) giữ nguyên submit:task.","Deny-path HTTP SAU contract: employee 201 + company-admin 201 POST /tasks/:taskId/comments (qua comment:task); user KHÔNG role → 403; engine can(comment:task)=true cho 4 role có grant.","RED-first proof: chạy int-spec đã cập nhật trên lane DB migrate tới 0485 (TRƯỚC 0486) → ĐỎ ((c') expect 0 actual 2; FORBIDDEN comment:comment actual [employee,company-admin]); apply 0486 → XANH toàn spec.","Gate int-spec = hasDb && LANE_DB (DB cô lập mediaos_taskrecon2). FULL gate security-reviewer + database-reviewer PASS. Typecheck xanh. Journal đơn điệu idx166>165."]
testTasks: ["RED int-spec (cập nhật file có sẵn task-recon-grants.int-spec.ts): (c') lật expect(n).toBe(2) → toBe(0) + đổi tên/JSDoc mô tả 'đã contract (RECON-2)'; FORBIDDEN_RESIDUAL += {action:'comment',resourceType:'comment'}; comment đầu file cập nhật trạng thái expand→contract.","Deny-path HTTP: thêm login company-admin → POST comment 201; seed user thứ 5 KHÔNG gán role → POST comment 403 (PermissionGuard deny-by-default).","Chuỗi RED→GREEN trên lane DB cô lập: lane-db-setup --reset → migrate 0000..0485 (0486 chưa vào journal HOẶC dùng journal head-1 trick như RECON-1) → spec ĐỎ đúng các test kỳ vọng → thêm 0486 vào journal → migrate → spec XANH 100%; re-chạy SQL 0486 trực tiếp qua psql lần 2 → NOTICE 0 row (idempotent proof, drizzle journal skip re-run nên phải chạy tay).","Regression (plan-reviewer caution): chạy TOÀN BỘ suite @mediaos/api trên lane DB hậu-0486 — đặc biệt apps/api/src/foundation/seed/task-permissions-seed.int.spec.ts (phần D snapshot chạm resource 'comment'; phân tích = vẫn xanh, phải chứng minh empirically). Đối chiếu baseline ~31 int-spec env-red (Vault/KMS/2FA/mail — memory 2026-07-09) trước khi kết luận đỏ do diff. tasks.permissions.spec.ts (unit) không đổi vẫn xanh. KHÔNG sửa test để pass — sửa migration nếu đỏ."]
steps: ["1. Verify tiên quyết (ĐÃ XONG phiên này — bằng chứng §1): grep pair legacy == 0 · prod/dev-online chạy code mới · DB transitional đúng.","2. contractVerify TRƯỚC (RED): cập nhật int-spec, chạy trên lane DB head 0485 → ĐỎ đúng chỗ.","3. contractMig: viết 0486 + journal idx166/when 1717500825000 → migrate lane DB → spec XANH; chạy migrate lần 2 → NOTICE 0 row (idempotent proof).","4. Typecheck + commit vào auto/S4-TASK-RECON-2 (worktree riêng, KHÔNG đụng master local).","5. FULL gate: security-reviewer + database-reviewer trên diff đã commit.","6. Push + gh pr create base master — vùng đỏ: KHÔNG gắn nhãn auto-merge, người chốt merge. RUNBOOK sau merge (plan-reviewer caution — verify lúc viết plan ≠ lúc migrate): NGAY TRƯỚC `pnpm db:migrate` trên MỖI env, RE-VERIFY binary đang chạy enforce ('comment','task') — grep dist đang chạy chứa RequirePermission(\"comment\", \"task\") + PID start-time ≥ mtime dist (landmine: m dev-online recompile chung dist prod; rollback về code trước #131 sẽ enforce lại comment:comment). Nếu binary cũ → DỪNG migrate, restart service với dist mới trước. Sau đó migrate mediaos + mediaos_dev (m dev-online-db); KHÔNG cần restart service (code không đổi, chỉ gỡ grant chết)."]
```

## §1 — BẰNG CHỨNG ĐIỀU KIỆN TIÊN QUYẾT (verify 2026-07-10, phiên này — done_when#2)

Done_when yêu cầu: _"code gate ('comment','task') ĐÃ deploy và chạy ổn định trên mọi môi trường (prod + dev-online); grep == 0. Nếu chưa, DỪNG."_ Kết quả verify:

| # | Điều kiện | Bằng chứng | Kết quả |
| --- | --- | --- | --- |
| 1 | `grep -rn "'comment', *'comment'" apps/api/src` == 0 | Grep toàn `apps/api/src` 2026-07-10 | ✅ 0 match |
| 2 | Code gate trên master | PR #131 (RECON-1) merged 2026-07-09; `tasks.controller.ts` POST comments enforce `('comment','task')` | ✅ |
| 3 | Prod (3100) chạy code mới | dist build 14:45 2026-07-10 chứa `RequirePermission("comment", "task")` (dist/tasks/tasks.controller.js:189); process PID 38504 khởi động **14:49 2026-07-10** (SAU build); health 200 | ✅ |
| 4 | Dev-online (3200) chạy code mới | process PID 41072 khởi động 14:45 2026-07-10; health 200 | ✅ |
| 5 | 2 DB đã áp 0480→0485 | `drizzle.__drizzle_migrations` đếm **166** trên CẢ `mediaos` và `mediaos_dev` (head 0485) | ✅ |
| 6 | Trạng thái transitional đúng | Query cả 2 DB: employee + company-admin giữ SONG SONG `comment:task` (canonical) và `comment:comment` (legacy) | ✅ |

**Lưu ý "ổn định":** prod mới restart với code gate lúc 14:49 hôm nay (soak tính bằng giờ). Owner đã chốt "chạy luôn" ở phiên 2026-07-10 → tiến hành. Migration này thuần gỡ grant CHẾT (không code nào enforce `comment:comment` nữa — grep #1) nên rủi ro hành vi = 0 khi #1 đúng; test HTTP 201 sau contract chứng minh đường comment sống nguyên vẹn qua `comment:task`.

## §2 — QUYẾT ĐỊNH CATALOG ROW ('comment','comment') — GIỮ (done_when#4)

Query **DB thật** 2026-07-10 (cả `mediaos` + `mediaos_dev`, re-verify sau plan-review): ngoài employee + company-admin (2 grant sẽ gỡ), còn **7 system role media legacy** (`company_id IS NULL`) giữ grant `comment:comment`:
`channel-manager · editor · hr-manager · project-manager · qa-reviewer · script-writer · uploader` (park-list de-media-fy, ngoài phạm vi WO này). Ghi chú: `hr-manager` KHÔNG seed ở 0005 (plan-reviewer soi đúng) nhưng TỒN TẠI trong DB thật với grant này — nguồn sự thật cho quyết định catalog là DB, không phải file seed.

**Object-level (done_when#4 "kiểm role_permissions + object-level"):** query `object_permissions` JOIN `permissions` trên cả 2 DB = **0 row** tham chiếu `comment:comment` — không có override object-level nào bị ảnh hưởng.

→ Theo done_when#4: _"nếu còn tham chiếu → chỉ gỡ grant, giữ catalog row"_. **KHÔNG** `DELETE FROM permissions`. Việc dọn role media legacy + catalog media là WO park/cleanup riêng (ngoài Sprint 4).

## §3 — MIGRATION 0486 (contractMig)

- **File:** `apps/api/migrations/0486_s4_taskrecon2_contract_comment_legacy.sql` · **Journal:** idx 166, when 1717500825000 (head 0485 = idx 165 / when 1717500820000 — verify lại ngay trước khi tạo; nhánh `auto/S4-TASK-BE-1` đang mở CHƯA mint migration, đã kiểm 2026-07-10).
- **Nội dung:** 1 DO-block duy nhất, mirror khối park (4) của 0480:
  - `targets := ARRAY[['employee'], ['company-admin']]` — resolve `role_id` (`company_id IS NULL AND deleted_at IS NULL`), resolve `permission_id` của `('comment','comment')`;
  - role/permission không tồn tại → `CONTINUE` (không có gì để gỡ — DB mới migrate sạch từ 0000 có thể không có grant này nếu 0005 đổi sau; hiện 0005 vẫn seed nó nên thực tế sẽ DELETE 1 row/role);
  - `DELETE FROM role_permissions WHERE role_id=… AND permission_id=… AND effect='ALLOW'` — **per-pair, KHÔNG blanket**;
  - `RAISE NOTICE '[0486] contract comment:comment — % grant DELETE'`.
- **KHÔNG có:** DDL · UPDATE `is_sensitive` · đụng RLS/policy/grant 0005 · DELETE catalog (§2) · đụng role media legacy / custom role company-scoped (`company_id NOT NULL` không match filter).
- **Idempotent:** chạy lại → DELETE 0 row. **Rollback (manual, tham khảo — plan-reviewer đã vá):** INSERT lại 2 grant `('comment','comment')` ALLOW với **data_scope DEFAULT của cột** (0005 INSERT không chỉ định scope → nhận default, KHÔNG phải `Company` cố ý); scope của grant này vô nghĩa về hành vi vì không code nào enforce cặp đó (grep == 0). Chỉ cần khi rollback code về trước #131 — thực tế không còn đường về.

## §4 — INT-SPEC (contractVerify) — thay đổi trên file CÓ SẴN

`apps/api/test/integration/task-recon-grants.int-spec.ts` (gate `hasDb && LANE_DB` GIỮ NGUYÊN):

1. **(c') lật:** `expect(n).toBe(2)` → `toBe(0)`; đổi tên test `"(c') comment:comment ĐÃ GỠ khỏi employee + company-admin (contract RECON-2)"` + cập nhật JSDoc khối EXPAND-ONLY đầu file (trạng thái transitional đã đóng).
2. **FORBIDDEN_RESIDUAL += `{ action: "comment", resourceType: "comment" }`** → test (c) tự sinh case mới quét 4 role canonical.
3. **(b)/(b') KHÔNG đổi:** tập task+project không chứa resource `comment`; scope Own/Company của `comment:task` giữ nguyên.
4. **(d) KHÔNG đổi:** re-park dùng `submit:task` (comment ghi chú "không dùng comment:comment vì test (c') khoá transitional" cập nhật lại cho khớp trạng thái mới — giờ comment:comment cũng đã gỡ, DELETE 0 row nếu dùng; giữ submit:task cho ổn định).
5. **PHẦN 2 HTTP thêm 2 test:** company-admin login → POST comment **201** (done_when yêu cầu tường minh); user thứ 5 KHÔNG gán role → POST comment **403** (deny-by-default tầng HTTP — hiện 4 role canonical đều có comment:task từ 0485 nên "role không grant" phải là user không role).

## §5 — RỦI RO & BIÊN

| Rủi ro | Đánh giá |
| --- | --- |
| Route sống nào khác còn enforce comment:comment? | Grep == 0 (§1#1). Object-level/user-level grant KHÔNG bị đụng (chỉ DELETE role_permissions của 2 system role). |
| Custom role company-scoped mất quyền? | Filter `company_id IS NULL` → không match custom role. |
| Cache permission engine giữ grant cũ? | Không ảnh hưởng hành vi: không code nào check comment:comment; TTL cache tự hết. |
| Đụng số migration với lane song song? | `auto/S4-TASK-BE-1`/`NOTI-BE-4`/`DASH-BE-1` đang mở — đã kiểm: chưa nhánh nào mint 0486 (2026-07-10). Verify lại journal ngay trước commit. |
| Cửa sổ 403 khi migrate prod? | Không: grant bị gỡ là grant CHẾT (code chạy trên mọi env đã enforce comment:task — §1#3/#4). Migrate không cần restart. |
