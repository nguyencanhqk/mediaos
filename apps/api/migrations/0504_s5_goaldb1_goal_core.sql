-- Migration 0504: S5-GOAL-DB-1 (🔴 RED, zone=red, crown) — GOAL Core (DB-11 §6.1/§6.2).
--
-- MỤC TIÊU (plan docs/plans/S5-GOAL-DB-1.md M1):
--   BUILD 2 bảng MỚI DB-11:
--     • goals        — cây mục tiêu 1 bảng cho MỌI cấp (company/department/project/employee, GOAL-DEC-001).
--                      company_id NOT NULL. RLS+FORCE + policy literal-GUC. soft-delete. CHECK level↔cột-neo
--                      (bản SIẾT sau review: project ⇒ department_id/employee_id NULL; employee ⇒ department_id/
--                      project_id NULL). FK ĐƠN CỘT (bẫy composite SET NULL #247). GRANT app SELECT,INSERT,UPDATE
--                      (soft-delete = UPDATE — KHÔNG DELETE). worker SELECT.
--     • goal_updates — sổ check-in/finalize/reopen APPEND-ONLY (BẤT BIẾN #2). company_id NOT NULL (policy cần
--                      cột này). KHÔNG updated_at/deleted_at (ledger). GRANT app SELECT,INSERT ONLY — KHÔNG
--                      UPDATE/DELETE. worker SELECT.
--
-- ⚠️ BẢN ĐỒ TÊN DB-11 → QUAN HỆ THẬT: departments → org_units · employees → employee_profiles · projects tồn tại.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS ENABLE + FORCE + policy tenant_isolation literal-GUC TẠO TRƯỚC mọi INSERT (WO này KHÔNG seed). Policy
--      NGUYÊN VĂN mẫu 0479 notification_delivery_logs / 0495: USING+WITH CHECK (company_id = NULLIF(current_setting
--      ('app.current_company_id', true), '')::uuid). NULLIF+`, true` bắt buộc (thiếu `, true` nổ khi GUC chưa set;
--      thiếu NULLIF nổ cast ''→uuid). Tương thích set_config PgBouncer txn-mode. rls-coverage-assert soi GUC trong
--      USING/WITH CHECK cho MỌI bảng company_id ⇒ 2 bảng này tự động vào lưới.
--   #2 goal_updates APPEND-ONLY: GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE. KHÔNG deleted_at (ledger, không
--      soft-delete). goals soft-delete (deleted_at) — GRANT UPDATE (đánh dấu xoá = UPDATE), KHÔNG DELETE.
--   #3 goals/goal_updates KHÔNG lưu secret/PII nhạy cảm — note/name là dữ liệu nghiệp vụ thường (ép ở service).
--   #5 UUID PK gen_random_uuid() · timestamptz UTC-at-rest (ADR-0008) · soft-delete deleted_at/by (goals).
--   • DDL thủ công (RLS/grant/CHECK/partial-index không biểu diễn được bằng Drizzle) — KHÔNG db:generate
--     (db:generate sẽ DROP schema media/finance đang park). schema/goals.ts là PARITY-only.
--   • FK ON DELETE: anchor department/project/employee/owner + company + goal_id/actor CASCADE (cột NOT NULL hoặc
--     anchor CHECK cấm SET NULL); audit-user created/updated/deleted/finalized_by SET NULL; parent_goal_id SET NULL
--     (orphan con, KHÔNG cascade — mirror tasks.parent_task_id 0478). actor_user_id CASCADE mirror
--     notification_delivery_logs.recipient_user_id (0479:164 — append-only + NOT NULL user FK).
--
-- BAND 0504 (lane S5-GOAL-DB-1). Journal: idx 184, when 1717587306000 (> head 0503 idx 183 / 1717587305000).
--   Nối tiếp ĐƠN ĐIỆU sau 0503_s5_subtask1_leaf_counting.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── 1. goals (DB-11 §6.1 — cây mục tiêu 1 bảng; company_id NOT NULL) ───────────────
CREATE TABLE IF NOT EXISTS goals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- company_id NOT NULL + DEFAULT literal-GUC: app khỏi tự set, WITH CHECK vẫn chặn gán sai tenant.
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  goal_code          varchar(100) NOT NULL,
  name               varchar(255) NOT NULL,
  description        text,
  level              varchar(20) NOT NULL,
  -- anchor cột (FK ĐƠN CỘT). CASCADE: xoá cứng đơn vị/dự án/nhân viên neo ⇒ xoá goal của nó (anchor CHECK cấm
  -- SET NULL — department-goal với department_id NULL sẽ vỡ CHECK). Thực tế soft-delete; cứng = admin/cleanup.
  department_id      uuid REFERENCES org_units(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES projects(id) ON DELETE CASCADE,
  employee_id        uuid REFERENCES employee_profiles(id) ON DELETE CASCADE,
  parent_goal_id     uuid REFERENCES goals(id) ON DELETE SET NULL,
  owner_employee_id  uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  period_type        varchar(20) NOT NULL,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  measure_type       varchar(20) NOT NULL DEFAULT 'percent',
  target_value       numeric(18, 2),
  current_value      numeric(18, 2),
  unit               varchar(50),
  progress_mode      varchar(20) NOT NULL DEFAULT 'manual',
  progress_percent   numeric(5, 2),
  weight             numeric(8, 2) NOT NULL DEFAULT 1,
  status             varchar(20) NOT NULL DEFAULT 'Draft',
  finalized_at       timestamptz,
  finalized_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata           jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_goals_level
    CHECK (level IN ('company', 'department', 'project', 'employee')),
  -- level ↔ cột neo (GOAL-ERR-001, bản SIẾT — thừa-neo cũng vỡ).
  CONSTRAINT chk_goals_level_anchor CHECK (
    (level = 'company'    AND department_id IS NULL     AND project_id IS NULL     AND employee_id IS NULL) OR
    (level = 'department' AND department_id IS NOT NULL AND project_id IS NULL     AND employee_id IS NULL) OR
    (level = 'project'    AND project_id IS NOT NULL    AND department_id IS NULL  AND employee_id IS NULL) OR
    (level = 'employee'   AND employee_id IS NOT NULL   AND department_id IS NULL  AND project_id IS NULL)
  ),
  CONSTRAINT chk_goals_period       CHECK (period_end >= period_start),
  CONSTRAINT chk_goals_period_type  CHECK (period_type IN ('quarter', 'year', 'custom')),
  CONSTRAINT chk_goals_measure      CHECK (measure_type IN ('percent', 'number', 'boolean')),
  CONSTRAINT chk_goals_mode         CHECK (progress_mode IN ('manual', 'project', 'tasks', 'children')),
  CONSTRAINT chk_goals_mode_project CHECK (progress_mode <> 'project' OR level = 'project'),
  CONSTRAINT chk_goals_status       CHECK (status IN ('Draft', 'Active', 'Completed', 'Cancelled')),
  CONSTRAINT chk_goals_progress
    CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)),
  CONSTRAINT chk_goals_weight       CHECK (weight > 0),
  CONSTRAINT chk_goals_no_self_parent
    CHECK (parent_goal_id IS NULL OR parent_goal_id <> id)
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT (CLAUDE.md §3) — literal-GUC policy mẫu 0479/0495 (company_id NOT NULL) ──
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE goals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON goals;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON goals
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Index (DB-11 §6.1): 1 unique (mã/company) + 5 partial theo use case (§8).
CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_company_code_active
  ON goals (company_id, goal_code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_goals_company_level_period
  ON goals (company_id, level, period_start DESC) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_goals_company_department
  ON goals (company_id, department_id, status) WHERE deleted_at IS NULL AND department_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_goals_company_project
  ON goals (company_id, project_id) WHERE deleted_at IS NULL AND project_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_goals_company_employee
  ON goals (company_id, employee_id, period_start DESC) WHERE deleted_at IS NULL AND employee_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_goals_company_parent
  ON goals (company_id, parent_goal_id) WHERE deleted_at IS NULL AND parent_goal_id IS NOT NULL;
--> statement-breakpoint
-- goals soft-delete: App SELECT/INSERT/UPDATE — KHÔNG DELETE (BẤT BIẾN #2, đánh dấu xoá = UPDATE). worker SELECT.
GRANT SELECT, INSERT, UPDATE ON goals TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON goals TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 2. goal_updates (DB-11 §6.2 — sổ check-in APPEND-ONLY; company_id NOT NULL) ───────────────
-- APPEND-ONLY (BẤT BIẾN #2): KHÔNG updated_at/deleted_at. recompute tự động KHÔNG ghi (tránh phình — DB-11 §6.2).
CREATE TABLE IF NOT EXISTS goal_updates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies(id) ON DELETE CASCADE,
  goal_id               uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  update_type           varchar(20) NOT NULL,
  -- actor NOT NULL → CASCADE (mirror notification_delivery_logs.recipient_user_id 0479:164 — append-only + NOT NULL).
  actor_user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_current_value     numeric(18, 2),
  new_current_value     numeric(18, 2),
  old_progress_percent  numeric(5, 2),
  new_progress_percent  numeric(5, 2),
  confidence            smallint,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_goal_updates_type
    CHECK (update_type IN ('checkin', 'finalize', 'reopen')),
  CONSTRAINT chk_goal_updates_confidence
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100))
);
--> statement-breakpoint
ALTER TABLE goal_updates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE goal_updates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON goal_updates;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON goal_updates
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_goal_updates_goal
  ON goal_updates (company_id, goal_id, created_at DESC);
--> statement-breakpoint
-- APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE cho app role. worker SELECT.
GRANT SELECT, INSERT ON goal_updates TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON goal_updates TO mediaos_worker;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DROP TABLE IF EXISTS goal_updates CASCADE;
-- DROP TABLE IF EXISTS goals CASCADE;
