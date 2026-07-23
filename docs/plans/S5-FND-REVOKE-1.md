# S5-FND-REVOKE-1 — REVOKE DELETE `org_units` + `projects` khỏi `mediaos_app`

> Lane 🔴 crown (chạm grant cấp-bảng của app role). Gate: FULL (database-reviewer + security-reviewer + silent-failure-hunter). Clone mẫu đã ship **0467** (REVOKE DELETE companies/users).

## 1. Vì sao (finding gate S5-GOAL-DB-1)

- `goals.department_id`/`project_id` tham chiếu `org_units`/`projects` với **ON DELETE CASCADE** (bắt-buộc-về-CHECK trong DB-11). Nếu có đường `DELETE FROM org_units|projects` chạy bằng app role → **cascade-xoá cứng goals + goal_updates (ledger)** mà KHÔNG qua soft-delete, KHÔNG audit ⇒ vỡ BẤT BIẾN #2.
- G-era vẫn còn `GRANT SELECT, INSERT, UPDATE, DELETE` cho `mediaos_app`:
  - `0006:36` → `org_units`
  - `0007:61` → `projects`
- Service hiện tại **chỉ soft-delete** (set `deleted_at`). Cần kéo 2 bảng này về đúng chuẩn band 0431+ (app role không có DELETE) — đúng như 0467 đã làm cho companies/users.

## 2. Precondition — expand/contract (memory `migration-expand-contract-required`)

REVOKE một grant mà live code còn `enforce`/dùng = cửa sổ lỗi. Phải chứng minh không còn **luồng hard-delete HỢP LỆ** trước khi siết (nếu còn → tách 2 release).

**Verify (2026-07-23, main worktree @ master `d2c1d4f3`):**
- **0 caller TĨNH**: `grep .delete(orgUnits|projects` + `grep -E 'DELETE\s+FROM\s+(org_units|projects)'` trong `apps/api/src` (loại spec) → **0**. Các hit còn lại chỉ là comment endpoint HTTP `DELETE /projects/:id` (thân hàm = **soft-delete**), `DELETE /projects/:id/members` (soft-remove `project_members`), và một `SELECT` trong `tasks.repository.ts:304`.
- **CÓ 1 caller ĐỘNG (plan-review round 1 phát hiện):** `retention.service.ts:521 _deleteEligible()` chạy ``sql`DELETE FROM ${sql.identifier(entityType)} …` `` qua `withTenant` (⇒ role `mediaos_app`), với `entityType` = `data_retention_policies.entity_type` (`varchar(100)` **KHÔNG có CHECK whitelist** — mig 0435:98). `'org_units'`/`'projects'` lọt regex `^[a-z_][a-z0-9_]*$` và **KHÔNG** nằm trong `PROTECTED_TABLES`. Đường live qua `@SystemJobHandler` RetentionCleanupJob (xóa thật khi kill-switch `RETENTION_JOB_ENABLED='true'` + policy `is_enabled` + `cleanup_action='Delete'`).

⇒ **REVOKE vẫn ship 1 release (contract-only-an-toàn), KHÔNG tách 2 release** — vì hard-delete org_units/projects qua retention **vốn đã vi phạm BẤT BIẾN #2** (cascade-xoá goals + ledger goal_updates), KHÔNG phải luồng hợp lệ cần bảo tồn. 4 lý do an toàn: (a) **0 policy seed** cho org_units/projects (`grep foundation/**/seed* + migrations = 0`), (b) kill-switch mặc định **OFF** (dryRun=true), (c) thiết kế đã coi REVOKE-DELETE-ở-DB là backstop (chính comment `job-handler.ts:21` tự nhận PROTECTED_TABLES là "lớp app phòng-thủ-thứ-hai TRÊN REVOKE-ở-DB"), (d) cascade goals/goal_updates = vi phạm #2.

### 2.1 Đóng lệch defense-in-depth (plan-review BLOCKING #2)

Sau REVOKE, nếu prod có policy `Delete` cho org_units/projects (dữ liệu runtime) + kill-switch ON → `_deleteEligible` ném **42501 KHÔNG bắt** ⇒ cả lượt cleanup tenant fail (trước REVOKE: âm thầm hard-delete — tệ hơn nhưng "xanh"). Hai tầng D-I-D (app `PROTECTED_TABLES` ↔ DB REVOKE) đang **lệch** cho 2 bảng này.
→ Thêm `org_units` + `projects` vào `RetentionService.PROTECTED_TABLES` (cùng domain `foundation/retention`) ⇒ retention **no-op có kiểm soát** (`deletedRecords=0` + log warn) thay vì ném 42501. Hai tầng khớp nhau; DB REVOKE là backstop cuối.

## 3. Thay đổi (migration + journal + retention guard + int-spec + doc)

### 3.1 Migration `0510_s5_fndrevoke1_org_units_projects_revoke_delete.sql`
- Đánh số nối tiếp head `0509` (idx 189 / when 1717587311000) → **idx 190 / when 1717587312000**.
- Nội dung (mẫu 0467, idempotent):
  1. `REVOKE DELETE ON org_units, projects FROM mediaos_app;`
  2. `GRANT SELECT, INSERT, UPDATE ON org_units, projects TO mediaos_app;` — tái khẳng định phạm vi, KHÔNG cấp lại DELETE.
  3. **Fail-LOUD `DO $$`** dùng `has_table_privilege`: sau migration `mediaos_app` KHÔNG còn DELETE trên cả 2 bảng, và VẪN còn SELECT/INSERT/UPDATE (chống over-revoke).
- **KHÔNG** đụng RLS/FORCE/policy (giữ nguyên mig 0006/0007). KHÔNG backfill company_id. KHÔNG `db:generate` (grant không biểu diễn được bằng drizzle schema — SQL tay theo convention 04xx).
- Cập nhật `meta/_journal.json`: thêm entry idx 190.

### 3.2 Retention guard `retention.service.ts` + regression `retention.service.spec.ts`

- `retention.service.ts`: thêm `"org_units"` + `"projects"` vào `PROTECTED_TABLES` với comment RIÊNG (KHÔNG phải append-only — chúng soft-delete; lý do bảo vệ = chống cascade-xoá goals + ledger `goal_updates`, khớp mig 0510).
- `retention.service.spec.ts`: mảng RIÊNG `CASCADE_GUARD_TABLES = ["org_units","projects"]` + 2 `it.each` (mẫu `APPEND_ONLY_TABLES`): (1) `isProtectedTable` = true; (2) policy `Delete` + `is_enabled` + `dryRun=false` ⇒ `deletedRecords=0` + `harness.calls.execute===1` (chỉ COUNT, KHÔNG phát lệnh DELETE thứ hai). Đây là regression pin cho §2.1.

### 3.3 Int-spec `apps/api/test/integration/org-projects-revoke-delete.int-spec.ts`

Đặt tại `test/integration/` (glob `test/**/*.int-spec.ts` — nơi idiomatic cho deny-path/tenant-isolation, memory `src-green-is-not-integration-green`; tránh tạo module dir rỗng vì org_units/projects nằm rải `employees/`+`goals/`+`tasks/`). Gate cứng `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`), `describe.skipIf(!runDb)`:
- **D1** — app role `DELETE FROM org_units` → DENIED (42501 insufficient_privilege).
- **D2** — app role `DELETE FROM projects` → DENIED (42501).
- **P3 (positive-guard, INSERT-TRƯỚC)** — trong 1 `BEGIN … ROLLBACK` dưới tenant context (`set_config app.current_company_id`): **INSERT org_unit + project trước** (company_id auto từ GUC, `name` kèm TAG unique tránh đụng `*_company_name_active_uq`), rồi `SELECT` + `UPDATE deleted_at` trên chính row vừa insert ⇒ chứng minh REVOKE không quá tay (S/I/U nguyên vẹn). ROLLBACK để không side-effect.
- Tên bảng ghép chuỗi (`["org","_units"].join("")`) để guard-immutability scan tĩnh không hiểu nhầm là hard-delete thật (mẫu 0467).
- RED-TRƯỚC theo lý lẽ 0467: chưa có mig 0510 thì DELETE resolve 0-row do RLS FORCE (KHÔNG 42501) ⇒ D1/D2 đỏ; sau mig ⇒ privilege-check fail TRƯỚC RLS ⇒ 42501 ⇒ xanh.

## 4. Nghiệm thu (done_when)

- [ ] Grep caller (§2: 0 tĩnh + 1 động retention đã đóng bằng PROTECTED_TABLES) + migration REVOKE + fail-loud `has_table_privilege`.
- [ ] Regression unit `retention.service.spec.ts` (CASCADE_GUARD) xanh — retention no-op cho org_units/projects.
- [ ] `bash harness/check.sh --lane-db` (Postgres cô lập): D1/D2/P3 xanh THẬT (không SKIP) + suite HR/TASK hiện có vẫn xanh. Trước PR: `bash harness/check.sh --all` (hoặc `REQUIRE_LANE_DB=1`) — ép deny-path chạy thật, chống xanh-giả (memory `ci-skips-most-integration-specs`).
- [ ] FULL gate DB (database-reviewer + security-reviewer + silent-failure-hunter) PASS.

## 5. Rủi ro / phối hợp

- **Tranh số migration với `S5-SYS-CLEAN-1`** (phiên khác đang chạy, cũng thêm migration): cả hai cùng nhắm 0510. Xử lý ở merge-time — nếu SYS-CLEAN-1 merge trước, PR này renumber 0510→0511 (đổi tên file + tag + `_journal` idx). Không chặn được lúc code; nêu rõ trong PR body.
- **KHÔNG chạm** `scheduler/**`, `goals/**`, `tasks/**` — thu hẹp paths để không va `S5-GOAL-BE-2`.
- Down-migration: KHÔNG khôi phục DELETE (BẤT BIẾN #2) — chỉ ghi tham khảo trong comment.
