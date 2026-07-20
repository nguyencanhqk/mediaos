# Plan S5-GOAL-DB-1 — Schema + migration GOAL core + seed (0504–0507 dự kiến)

> WO: `S5-GOAL-DB-1` (zone **red**, lane DB TUẦN TỰ — không chạy song song migration khác).
> Nguồn sự thật: [SPEC-10 GOAL](<../SPEC/SPEC-10 GOAL.md>) §11/§12/§17 · [DB-11](<../DB/DB-11 GOAL Database Design.md>) §6/§9 · review đối kháng 2026-07-20 (plan-reviewer BLOCK → các fix đã nhập vào docs).
> Head migration lúc viết plan: **idx 183 / 0503** — PHẢI kiểm `_journal.json` lại ngay trước khi đánh số (bẫy trùng số `wo-paths-drive-gate-and-scheduler`).

## 0. Quyết định đã chốt (không mở lại trong lúc code)

| # | Quyết định | Nguồn |
| --- | --- | --- |
| D1 | `is_sensitive = false` cho CẢ 7 cặp quyền GOAL (kể cả finalize) — không đụng allowlist sensitive FE, không đụng pin `auth-seed-canonical-roles` | Owner chốt 20/07/2026 (AskUser trong phiên seed) |
| D2 | `goal_code` format mirror 0498: `sequence_key='goal'` · `scope_type='Company'` · `module_code='GOAL'` · prefix `'GOAL-'` · **`padding_length=4`** (tên cột thật — 0434:53) · `reset_policy='Never'` · `increment_by=1` · `current_value=0` ⇒ mã đầu `GOAL-0001`. KHÔNG backfill (bảng mới, 0 hàng) | mirror 0498 contract |
| D3 | NOTI: UNION-ADD `'GOAL'` vào `chk_notification_events_module_code` + `'Goal'` vào `chk_notification_events_type` (DO-block mẫu 0474) TRƯỚC khi INSERT event; catalog const mở rộng type `NotiModuleCode += "GOAL"`, `NotiType += "Goal"` CÙNG commit | 0479:62-65 (CHECK hiện chưa có GOAL) |
| D4 | Module GOAL seed vào `modules`: `module_group='Collaboration'` (cùng nhóm TASK — 0435:292), `is_core=false`, `is_mvp=true`, `is_active=true`, `sort_order=6` (sau TASK=5) | 0435 + GOAL-DEC-002 |
| D5 | Ma trận grant per-pair (role canonical × 7 pair) — bảng dưới. Role `hr` chỉ view Company (phục vụ đánh giá Phase 2), KHÔNG grant ghi | SPEC-10 §11 (hr không nêu → đề xuất tối thiểu, owner duyệt qua PR) |

### D5 — Ma trận data_scope per-(permission, role)

| Pair \ Role | employee | manager | hr | company-admin |
| --- | --- | --- | --- | --- |
| `('access','goal')` | Own¹ | Own¹ | Own¹ | Own¹ |
| `('view','goal')` | Department | Department | Company | Company |
| `('create','goal')` | Own | Department | — | Company |
| `('update','goal')` | Own | Department | — | Company |
| `('delete','goal')` | Own | Department | — | Company |
| `('checkin','goal')` | Own | Department | — | Company |
| `('finalize','goal')` | **—** (không grant) | Department | — | Company |

¹ `access` = cổng nav, scope không mang nghĩa lọc dữ liệu — dùng Own như mẫu `('access','me')` 0495. "—" = KHÔNG INSERT hàng role_permissions.
**Tổng grant pin cứng = 22 hàng** (access 4 + view 4 + create 3 + update 3 + delete 3 + checkin 3 + finalize 2) — verify M3.6 đếm ĐÚNG 22, chống under/over-grant.
Ghi chú: goal cấp project còn thêm lớp ProjectAccessService ở BE-1 (service-layer, KHÔNG nằm trong seed này). super-admin KHÔNG enumerate ở migration (nhận qua SuperAdminBootstrap — mirror ghi chú 0481).

## 1. Migration (4 file, đánh số nối head THẬT)

### M1 `0504_s5_goaldb1_goal_core.sql` — bảng lõi + RLS + GRANT
1. `CREATE TABLE goals` đúng DB-11 §6.1: đủ cột + `chk_goals_level` + `chk_goals_level_anchor` (bản SIẾT sau review: project ⇒ `department_id IS NULL AND employee_id IS NULL`; employee ⇒ `department_id IS NULL AND project_id IS NULL`) + `chk_goals_period` + `chk_goals_period_type` + `chk_goals_measure` + `chk_goals_mode` + `chk_goals_mode_project` + `chk_goals_status` + `chk_goals_progress` + `chk_goals_weight` + `chk_goals_no_self_parent`; FK: company/department/project/employee/parent/owner + created_by/updated_by/deleted_by/finalized_by → users. **FK đơn cột, KHÔNG composite** (bẫy SET NULL composite #247).
2. `CREATE TABLE goal_updates` đúng DB-11 §6.2: **`company_id uuid NOT NULL REFERENCES companies(id)`** (policy M1.4 cần cột này — quên là CREATE POLICY nổ) + KHÔNG updated_at/deleted_at; `chk_goal_updates_type` + `chk_goal_updates_confidence`; FK goal_id → goals, actor_user_id → users; công ty ghi TƯỜNG MINH ở mọi INSERT.
3. Index: 6 index goals + 1 index goal_updates (tên + partial WHERE đúng DB-11).
4. **RLS TRƯỚC MỌI INSERT** (bất biến #1): `ENABLE ROW LEVEL SECURITY` + `FORCE` + policy `tenant_isolation` literal-GUC NGUYÊN VĂN mẫu 0479:194/0495:80 — `USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)` + `WITH CHECK` cùng vế — cho CẢ 2 bảng (thiếu `, true` là nổ khi GUC chưa set; thiếu `NULLIF` là nổ cast `''`→uuid; rls-coverage-assert soi GUC trong USING/WITH CHECK).
5. GRANT (mirror phong cách 0479/0434): `goals` → app role SELECT, INSERT, UPDATE (KHÔNG DELETE — soft-delete là UPDATE); `goal_updates` → app role **SELECT, INSERT ONLY** (bất biến #2); worker role SELECT cả 2.

### M2 `0505_s5_goaldb1_tasks_goal_id.sql` — liên kết đo
1. `ALTER TABLE tasks ADD COLUMN goal_id uuid NULL` + `ADD CONSTRAINT fk_tasks_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL` (đơn cột).
2. `CREATE INDEX idx_tasks_company_goal ON tasks (company_id, goal_id) WHERE goal_id IS NOT NULL AND deleted_at IS NULL`.
3. KHÔNG backfill, KHÔNG đụng RLS tasks (đã FORCE từ 0478).

### M3 `0506_s5_goaldb1_seed_module_perms_counter_audit.sql` — seed nghiệp vụ
1. Seed `modules` hàng GOAL theo D4 (ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING — mirror 0435/0495).
2. Seed 7 hàng `permissions` — bảng CHỈ có `(action, resource_type, is_sensitive)` (0005:56-62, KHÔNG có cột code/name — INSERT thêm cột là nổ): INSERT `(action, resource_type='goal', is_sensitive=false)` ON CONFLICT DO NOTHING; mã quy ước `GOAL.GOAL.*` chỉ ghi ở COMMENT (mirror 0495 ghi `-- ME.ACCESS`).
3. Grant `role_permissions` theo ma trận D5, kiểu **per-pair**: với TỪNG (pair, role): `DELETE` hàng scope-SAI rồi `INSERT ... ON CONFLICT DO NOTHING` scope đúng (mirror 0466/0476/0495 — per-(permission,role), KHÔNG UPDATE-hàng-loạt, KHÔNG CROSS JOIN blanket).
4. UNION-ADD `'goal'` vào CHECK `audit_logs.object_type` — clone nguyên DO-block 0474 (idempotent, đọc constraint hiện tại, chỉ ADD).
5. Seed `sequence_counters` 'goal' cho MỌI company theo D2 — clone 0498 bước (1) (ON CONFLICT DO NOTHING bare); KHÔNG cần bước backfill/sync (bảng goals rỗng).
6. **VERIFY fail-LOUD** (RAISE EXCEPTION — mirror 0498/0495): (a) đủ 7 permissions; (b) role_permissions ĐÚNG ma trận D5 — đếm theo từng role + **tổng ĐÚNG 22 hàng** + không có hàng scope lạ + employee KHÔNG có finalize; (c) mọi company có counter 'goal'; (d) CHECK audit_logs chứa 'goal'; (e) modules có GOAL active.

### M4 `0507_s5_goaldb1_noti_catalog_goal.sql` — catalog 2 event GOAL
1. UNION-ADD `'GOAL'` vào `chk_notification_events_module_code` + `'Goal'` vào `chk_notification_events_type` (2 DO-block mẫu 0474) — PHẢI trước INSERT.
2. INSERT `notification_events` (company_id NULL — global, mirror 0481/0490): `GOAL_ASSIGNED` (module GOAL, type Goal, priority Normal, is_enabled=true) + `GOAL_FINALIZED` (module GOAL, type Goal, priority Normal, is_enabled=true). **ON CONFLICT PHẢI kèm vị-từ partial-index** (unique trên event_code là PARTIAL — 0479:84-89; bare `ON CONFLICT (event_code)` nổ 42P10): `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` (nguyên văn 0481:104/0490:46).
3. INSERT `notification_templates` IN_APP vi-VN (mirror 0481:115 shape — template_code `<EVENT>__IN_APP__vi-VN`, is_default, variables_schema; **ON CONFLICT kèm vị-từ partial**: `ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` — khớp `uq_notification_templates_global_code_active` 0479:143):
   - `GOAL_ASSIGNED`: title "Bạn được giao mục tiêu mới"; body dùng `{goal_code}` `{goal_name}` `{assigner_name}` `{period_label}`; target route dùng `{goalId}` UUID (mirror bài học 0497 — KHÔNG nhét mã hiển thị vào target_url).
   - `GOAL_FINALIZED`: title "Mục tiêu đã được chốt kỳ"; body `{goal_code}` `{goal_name}` `{final_progress}`; KHÔNG số liệu nhạy cảm khác (SPEC-10 §18).
4. VERIFY fail-LOUD: 2 event tồn tại + enabled + mỗi event có ≥1 template Active default vi-VN; CHECK module_code chứa 'GOAL'.

## 2. Code đồng bộ CÙNG COMMIT (không db:generate cho DO-block)

| File | Thay đổi |
| --- | --- |
| `apps/api/src/db/schema/goals.ts` (MỚI) | bảng `goals` + `goalUpdates` drizzle, khớp 1-1 M1 (kể cả CHECK qua `check()` nếu pattern schema hiện dùng, không thì comment trỏ migration) |
| `apps/api/src/db/schema/index.ts` | APPEND khối export WO (hot-file rule §9.3 — không rewrite) |
| `apps/api/src/db/schema/audit.ts` | `AUDIT_OBJECT_TYPES += 'goal'` (0474 yêu cầu sync cùng commit) |
| `apps/api/src/db/schema/workflow.ts` | bảng `tasks` += cột `goalId` (additive — bảng thật nằm ở file này, tên di sản) |
| `apps/api/src/foundation/seed/notification-event-catalog.const.ts` | `NotiModuleCode += "GOAL"`, `NotiType += "Goal"`, `NOTI_EVENT_CATALOG += 2 entry` ĐỦ field `{module:"GOAL", eventCode, type:"Goal", priority:"Normal", isEnabled:true, isSystemEvent:false}` (spec assert từng cột) |
| `apps/api/test/integration/noti-seed-catalog-permissions.int-spec.ts` | **BUMP literal pin GIỮ NGUYÊN DẠNG LITERAL** (KHÔNG đổi sang biến — tautology giết drift-guard): `toBe(53)`→`toBe(55)`, `toBe(39)`(enabled)→`toBe(41)`, tổng template `39`→`41`; cập nhật nhãn/comment pin tương ứng |
| `apps/api/test/integration/rls-registry.ts` | đăng ký case `goals` + `goal_updates` (rls-coverage-assert quét) |

## 3. Int-spec (RED trước — viết & chạy FAIL trước khi viết migration)

File mới `apps/api/test/integration/goal-db-seed.int-spec.ts` (+ nương registry sẵn có):

1. **Cross-tenant deny**: qua rls-registry (`goals`, `goal_updates`) — company B không SELECT/INSERT được hàng company A qua app role + GUC.
2. **Append-only GRANT**: app role `UPDATE goal_updates` → lỗi 42501; `DELETE goal_updates` → 42501 (bất biến #2 ở tầng GRANT, không phải service).
3. **CHECK 23514 đúng ca**: level=department + project_id set → 23514; level=project + department_id set (NEO THỪA — bản siết) → 23514; level=employee + project_id set → 23514; period_end < period_start → 23514; weight=0 → 23514; mode='project' + level='employee' → 23514; parent_goal_id = id → 23514.
4. **Seed-assert**: module GOAL active; 7 permissions is_sensitive=false; ma trận D5 khớp TỪNG (role, pair, scope) + employee KHÔNG có finalize + hr KHÔNG có pair ghi; counter 'goal' MỌI company (prefix GOAL-, pad 4, Never); audit CHECK chứa 'goal'; 2 event GOAL enabled + template default vi-VN; CHECK module_code chứa 'GOAL'.
5. **FK hành vi**: xoá cứng goal (bằng owner-role trong test) → tasks.goal_id SET NULL, company_id task KHÔNG đổi (bẫy composite #247 — khẳng định bằng assert).
6. Gate chuẩn: `describe.skipIf(!hasDb || !process.env.LANE_DB)` (memory `integration-test-lane-db-gate`); spec đặt ở `test/integration/**` (KHÔNG src/ — memory `src-green-is-not-integration-green`).

## 4. Trình tự thực hiện & verify

1. Viết int-spec §3 → chạy `LANE_DB` → **RED** (bảng chưa có) — chụp bằng chứng.
2. Kiểm head `_journal.json` THẬT → viết M1→M4 + journal entries (idx/when đơn điệu tiếp head).
3. Code đồng bộ §2. KHÔNG `db:generate` (DO-block thủ công — mirror 0474/0490/0498).
4. `bash scripts/lane-db-setup.sh goaldb1` → `export LANE_DB=mediaos_goaldb1` → migration-smoke clean 0000→head + chạy toàn bộ int-spec GOAL → GREEN; chạy thêm `rls-coverage-assert` + `noti-seed-catalog-permissions` (2 spec canary dễ vỡ nhất vì mình mở rộng registry/catalog).
5. `pnpm --filter @mediaos/api typecheck` + `lint` + unit (`src/**`) — nhớ Turbo `TURBO_FORCE=1` khi lấy bằng chứng xanh (memory `turbo-cache-false-green`).
6. FULL gate: `database-reviewer` + `security-reviewer` + `rls-tenant-isolation-tester` + `silent-failure-hunter` — PASS hết mới mở PR.
7. PR (KHÔNG push master trực tiếp — vùng đỏ): nhánh `feat/s5-goal-db-1`, verify scope bằng `gh pr diff` (memory `harness-deploygate-pr-base`), owner chốt merge.

## 5. Rủi ro & biên

- **Trùng số migration với lane khác**: lane DB tuần tự + kiểm head ngay trước đánh số; nếu head đã nhích (0504 bị chiếm) → dùng số kế + đổi tên file/journal, KHÔNG chen band.
- **`modules.module_code` có CHECK enum không?** 0495 seed ME không cần mở CHECK ⇒ không có CHECK trên module_code (bằng chứng thực nghiệm); nếu implement phát hiện ngược lại → UNION-ADD như 0474, ghi vào PR.
- **Ảnh hưởng spec canary** (plan-reviewer vòng 1 sửa hướng): `noti-seed-catalog-permissions.int-spec.ts:89-92/190-197` pin CỨNG 53 mã / 39 enabled / 39 template — cách vá ĐÚNG là **bump literal 53→55, 39→41 (cả hai chỗ), GIỮ literal** để pin tiếp tục bắt drift; CẤM đổi thành `toBe(NOTI_EVENT_COUNT)` (tautology = giết chức năng pin — đúng lớp lỗi canonical-seed-pin-regression).
- **Down**: ghi chú manual cuối mỗi file (mirror 0498) — bảng mới chỉ cần DROP; CHECK union không cần down (ADD-only vô hại).
- KHÔNG đụng: FE, service/controller (BE-1), task_templates (DB-2/0508), luồng duyệt (không tồn tại — GOAL-DEC-003).
