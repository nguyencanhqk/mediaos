-- Migration 0478: S4-TASK-DB-1 (🔴 RED, zone=red, crown) — TASK Core (DB-06 §7).
--
-- MỤC TIÊU (plan docs/plans/S4-TASK-DB-1.md — Option-A evolve-additive, mirror ATT 0452):
--   (A) BUILD 5 bảng MỚI DB-06 (bắt buộc MVP): task_assignees · task_watchers · task_checklists ·
--       task_checklist_items · task_activity_logs. Mỗi bảng company-scoped:
--       CREATE TABLE (company_id NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id',true),'')::uuid
--       + FK companies) → ENABLE + FORCE ROW LEVEL SECURITY → POLICY tenant_isolation (USING+WITH CHECK
--       literal GUC form, mirror 0452 dòng 75-77) → indexes → GRANTs. KHÔNG seed (permission = S4-TASK-SEED-1).
--   (B) ALTER-ADD (additive, MỌI cột NULLABLE) trên 4 bảng media-era reconcile:
--       projects · project_members · tasks · task_comments — thêm cột DB-06, GIỮ NGUYÊN cột+CHECK+unique cũ
--       (status/priority lowercase · user_id · code/identifier/last_task_sequence · sequence). Cột enum
--       TitleCase MỚI (task_status/project_status/project_priority/member_status/project_role...) ≠ cột
--       lowercase cũ; CHECK tên MỚI, cho phép NULL, CHỈ trên cột mới. task_comments CHỈ thêm soft-delete
--       + created_by additive (grant/soft-delete-write để lại TASK-BE — OUT-OF-SCOPE WO này).
--   KHÔNG backfill ở WO này (chưa có nguồn map user→employee cho task/project — TASK-BE sẽ cut over).
--
-- ⚠️ BẢN ĐỒ TÊN DB-06 → QUAN HỆ THẬT (plan §1 — KHÔNG viết FK theo tên DB-06):
--   employees(id)   → employee_profiles(id)   (schema/employees.ts)  [KHÔNG có bảng `employees`]
--   departments(id) → org_units(id)           (schema/org.ts)        [KHÔNG có bảng `departments`]
--   users(id) · companies(id) · tasks(id) · projects(id) · files(id) → tồn tại, FK OK.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   • RLS+FORCE + POLICY TRƯỚC mọi INSERT/backfill. company_id NOT NULL DEFAULT NULLIF(current_setting(...))::uuid.
--   • task_activity_logs APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT app — KHÔNG UPDATE/DELETE (ledger
--     nghiệp vụ DB-06 §4.10/§7.12; khớp retention.service.ts:58). Không có deleted_at (append-only, không soft-delete).
--   • ALTER-ADD: MỌI cột NULLABLE (no NOT NULL) → không rewrite/fail trên row legacy lowercase. CHECK enum
--     tên MỚI cho phép NULL. Legacy-row dev/prod (none/not_started/active) KHÔNG bị ADD CONSTRAINT reject.
--   • timestamptz UTC-at-rest (ADR-0008) · UUID PK · soft-delete deleted_at/by (KHÔNG hard-delete).
--   • DDL thủ công (RLS/grant/CHECK không biểu diễn được bằng Drizzle) — KHÔNG db:generate.
--
-- BAND 0478 (lane S4-TASK-DB-1). Journal: idx 158, when 1717500785000 (> head 0477 idx 157 / 1717500780000).
--   Nối tiếp ĐƠN ĐIỆU sau 0477_s2_hrempfile1_employee_file_perms.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── 1. task_assignees (DB-06 §7.5 — người phụ trách, hỗ trợ nhiều assignee) ───────────────
CREATE TABLE IF NOT EXISTS task_assignees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- employee_id → employee_profiles(id) (DB-06 ghi `employees`, KHÔNG tồn tại).
  employee_id   uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  assignee_role text NOT NULL DEFAULT 'Main',
  status        text NOT NULL DEFAULT 'Active',
  assigned_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  removed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  removed_at    timestamptz,
  remove_reason text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_task_assignees_role   CHECK (assignee_role IN ('Main','CoAssignee','Reviewer')),
  CONSTRAINT chk_task_assignees_status CHECK (status IN ('Active','Removed'))
);
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_assignees;
CREATE POLICY tenant_isolation ON task_assignees
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
-- Chống trùng: 1 employee active/task + tối đa 1 Main active/task (DB-06 §7.5 §4.7).
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_assignees_active_employee
  ON task_assignees (company_id, task_id, employee_id)
  WHERE deleted_at IS NULL AND status = 'Active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_assignees_one_main_active
  ON task_assignees (company_id, task_id)
  WHERE deleted_at IS NULL AND status = 'Active' AND assignee_role = 'Main';
-- my-tasks (assignee + status + due qua tasks): assignee-scan theo employee.
CREATE INDEX IF NOT EXISTS idx_task_assignees_employee_status
  ON task_assignees (company_id, employee_id, status, assigned_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_assignees_task_status
  ON task_assignees (company_id, task_id, status) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON task_assignees TO mediaos_app;
GRANT SELECT ON task_assignees TO mediaos_worker;

-- ─────────────── 2. task_watchers (DB-06 §7.6 — người theo dõi task) ───────────────
CREATE TABLE IF NOT EXISTS task_watchers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  watcher_type text NOT NULL DEFAULT 'Manual',
  status       text NOT NULL DEFAULT 'Active',
  added_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  removed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  removed_at   timestamptz,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   timestamptz,
  deleted_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_task_watchers_type   CHECK (watcher_type IN ('Manual','Creator','ProjectManager','Mention','System')),
  CONSTRAINT chk_task_watchers_status CHECK (status IN ('Active','Muted','Removed'))
);
ALTER TABLE task_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_watchers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_watchers;
CREATE POLICY tenant_isolation ON task_watchers
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_watchers_active_employee
  ON task_watchers (company_id, task_id, employee_id)
  WHERE deleted_at IS NULL AND status IN ('Active','Muted');
CREATE INDEX IF NOT EXISTS idx_task_watchers_employee_status
  ON task_watchers (company_id, employee_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_watchers_task_status
  ON task_watchers (company_id, task_id, status) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON task_watchers TO mediaos_app;
GRANT SELECT ON task_watchers TO mediaos_worker;

-- ─────────────── 3. task_checklists (DB-06 §7.9 — nhóm checklist trong task) ───────────────
CREATE TABLE IF NOT EXISTS task_checklists (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies(id) ON DELETE CASCADE,
  task_id              uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title                text NOT NULL,
  description          text,
  order_index          integer NOT NULL DEFAULT 0,
  is_required_for_done boolean NOT NULL DEFAULT false,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at           timestamptz,
  deleted_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_task_checklists_title_not_empty CHECK (length(trim(title)) > 0)
);
ALTER TABLE task_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_checklists;
CREATE POLICY tenant_isolation ON task_checklists
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_task_checklists_task_order
  ON task_checklists (company_id, task_id, order_index) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON task_checklists TO mediaos_app;
GRANT SELECT ON task_checklists TO mediaos_worker;

-- ─────────────── 4. task_checklist_items (DB-06 §7.10 — item trong checklist) ───────────────
CREATE TABLE IF NOT EXISTS task_checklist_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  -- task_id denormalize (DB-06 §7.10) để query nhanh; checklist_id là cha trực tiếp.
  task_id             uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  checklist_id        uuid NOT NULL REFERENCES task_checklists(id) ON DELETE CASCADE,
  title               text NOT NULL,
  description         text,
  is_done             boolean NOT NULL DEFAULT false,
  done_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  done_by_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL,
  done_at             timestamptz,
  order_index         integer NOT NULL DEFAULT 0,
  metadata            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at          timestamptz,
  deleted_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_task_checklist_items_title_not_empty CHECK (length(trim(title)) > 0),
  CONSTRAINT chk_task_checklist_items_done_consistency CHECK (
    (is_done = false AND done_at IS NULL) OR (is_done = true AND done_at IS NOT NULL)
  )
);
ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklist_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_checklist_items;
CREATE POLICY tenant_isolation ON task_checklist_items
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_task_checklist_items_task
  ON task_checklist_items (company_id, task_id, is_done) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_checklist_items_checklist_order
  ON task_checklist_items (company_id, checklist_id, order_index) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON task_checklist_items TO mediaos_app;
GRANT SELECT ON task_checklist_items TO mediaos_worker;

-- ─────────────── 5. task_activity_logs (DB-06 §7.12 — APPEND-ONLY ledger project/task) ───────────────
-- APPEND-ONLY (BẤT BIẾN #2): KHÔNG deleted_at/by (không soft-delete). actor_user_id NULLABLE + FK SET NULL để
-- log SỐNG SÓT khi user bị xoá (ledger durability) — DB-06 ghi "Có" nhưng SET NULL thắng để không chặn xoá user.
CREATE TABLE IF NOT EXISTS task_activity_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
  task_id          uuid REFERENCES tasks(id) ON DELETE SET NULL,
  actor_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL,
  action           text NOT NULL,
  target_type      text NOT NULL,
  target_id        uuid,
  old_values       jsonb,
  new_values       jsonb,
  message          text,
  ip_address       text,
  user_agent       text,
  request_id       text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_task_activity_target_type CHECK (
    target_type IN ('Project','Task','Member','Comment','File','Checklist','ChecklistItem','Watcher','Assignee')
  )
);
ALTER TABLE task_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_activity_logs;
CREATE POLICY tenant_isolation ON task_activity_logs
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_task_activity_project_created
  ON task_activity_logs (company_id, project_id, created_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_activity_task_created
  ON task_activity_logs (company_id, task_id, created_at DESC) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_activity_actor_created
  ON task_activity_logs (company_id, actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_activity_action_created
  ON task_activity_logs (company_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_activity_target
  ON task_activity_logs (company_id, target_type, target_id, created_at DESC);
-- APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE cho app role.
GRANT SELECT, INSERT ON task_activity_logs TO mediaos_app;
GRANT SELECT ON task_activity_logs TO mediaos_worker;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (B) ALTER-ADD additive trên 4 bảng legacy — MỌI cột NULLABLE, CHECK MỚI cho phép NULL, GIỮ cột cũ.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── 6. ALTER projects — ADD cột DB-06 §7.1 (additive, NULLABLE) ───────────────
-- GIỮ: status(active/paused/archived) · priority(nullable lowercase) · code/identifier/last_task_sequence +
-- projects_status_check/projects_priority_check/projects_type_check + 3 unique legacy LIVE (code-gen guard).
-- Cột project_status/project_priority TitleCase MỚI ≠ status/priority lowercase cũ.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_code text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES org_units(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_priority text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_status text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress_percent numeric(5, 2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- CHECK tên MỚI (DB-06 §7.1) — CHỈ trên cột mới, NULL hợp lệ. DROP-then-ADD idempotent.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_projects_project_priority;
ALTER TABLE projects ADD CONSTRAINT chk_projects_project_priority
  CHECK (project_priority IS NULL OR project_priority IN ('Low','Medium','High','Urgent'));
ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_projects_project_status;
ALTER TABLE projects ADD CONSTRAINT chk_projects_project_status
  CHECK (project_status IS NULL OR project_status IN ('Planning','Active','On Hold','Completed','Cancelled','Archived'));
ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_projects_visibility;
ALTER TABLE projects ADD CONSTRAINT chk_projects_visibility
  CHECK (visibility IS NULL OR visibility IN ('Private','Internal','Public'));
ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_projects_progress_percent;
ALTER TABLE projects ADD CONSTRAINT chk_projects_progress_percent
  CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100));
-- project_code cột MỚI + partial-unique (GIỮ legacy code/identifier unique LIVE tới khi TASK-BE cut over).
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_company_project_code_active
  ON projects (company_id, project_code) WHERE deleted_at IS NULL AND project_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_company_project_status
  ON projects (company_id, project_status, start_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_company_owner_employee
  ON projects (company_id, owner_employee_id, project_status) WHERE deleted_at IS NULL;

-- ─────────────── 7. ALTER project_members — ADD cột DB-06 §7.2 (additive, NULLABLE) ───────────────
-- GIỮ: user_id(NOT NULL) · status(active/inactive) · project_members_status_check + project_members_active_uq
-- (company_id,project_id,user_id) WHERE deleted_at IS NULL LIVE (guard writer cũ). employee_id/member_status/
-- project_role là CỘT MỚI; partial-unique MỚI đo bằng employee_id + member_status='Active'.
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS project_role text;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS member_status text;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS joined_at timestamptz;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS left_at timestamptz;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS remove_reason text;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE project_members DROP CONSTRAINT IF EXISTS chk_project_members_project_role;
ALTER TABLE project_members ADD CONSTRAINT chk_project_members_project_role
  CHECK (project_role IS NULL OR project_role IN ('Owner','Manager','Member','Viewer'));
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS chk_project_members_member_status;
ALTER TABLE project_members ADD CONSTRAINT chk_project_members_member_status
  CHECK (member_status IS NULL OR member_status IN ('Active','Inactive','Removed'));
-- Partial-unique MỚI: 1 employee member Active/project. Guard employee_id IS NOT NULL (mirror ATT 0452:330-335)
-- vì phần lớn hàng legacy employee_id NULL (NULL distinct trong unique index Postgres ⇒ chưa enforce).
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_active_employee
  ON project_members (company_id, project_id, employee_id)
  WHERE deleted_at IS NULL AND member_status = 'Active' AND employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_members_employee_status
  ON project_members (company_id, employee_id, member_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_members_project_role
  ON project_members (company_id, project_id, project_role, member_status) WHERE deleted_at IS NULL;

-- ─────────────── 8. ALTER tasks — ADD cột DB-06 §7.4 (additive, NULLABLE) ───────────────
-- GIỮ: priority(NOT NULL DEFAULT 'none' lowercase) · status(not_started...) · task_type · sequence +
-- tasks_status_check/tasks_priority_check/tasks_task_type_check/tasks_origin_check + mọi index legacy LIVE.
-- task_status/task_priority TitleCase MỚI ≠ status/priority lowercase cũ; CHECK tên MỚI cho phép NULL.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_code text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reporter_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS creator_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS main_assignee_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES org_units(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_priority text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_status text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_hours numeric(10, 2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_locked boolean;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_task_priority;
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_task_priority
  CHECK (task_priority IS NULL OR task_priority IN ('Low','Medium','High','Urgent'));
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_task_status;
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_task_status
  CHECK (task_status IS NULL OR task_status IN ('Todo','In Progress','In Review','Done','Cancelled'));
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_estimated_minutes;
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_estimated_minutes
  CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0);
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_actual_hours;
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_actual_hours
  CHECK (actual_hours IS NULL OR actual_hours >= 0);
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_due_after_start;
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_due_after_start
  CHECK (due_at IS NULL OR start_at IS NULL OR due_at >= start_at);
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_not_self_parent;
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_not_self_parent
  CHECK (parent_task_id IS NULL OR parent_task_id <> id);
-- task_code cột MỚI + partial-unique (GIỮ legacy tasks.sequence LIVE tới khi TASK-BE cut over code-gen).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_company_task_code_active
  ON tasks (company_id, task_code) WHERE deleted_at IS NULL AND task_code IS NOT NULL;
-- my-tasks (assignee + status + due) + Kanban (project + status) + overdue candidate — trên CỘT MỚI.
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status_due
  ON tasks (company_id, main_assignee_employee_id, task_status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project_task_status
  ON tasks (company_id, project_id, task_status, sort_order, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_department_task_status
  ON tasks (company_id, department_id, task_status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_overdue_candidate
  ON tasks (company_id, due_at, task_status)
  WHERE deleted_at IS NULL AND task_status NOT IN ('Done','Cancelled') AND due_at IS NOT NULL;

-- ─────────────── 9. ALTER task_comments — ADD soft-delete + created_by (additive, NULLABLE) ───────────────
-- Legacy CHỈ có user_id + created_at (KHÔNG có deleted_at). ADD deleted_at/by + created_by TRƯỚC khi tạo index
-- tham chiếu deleted_at. Grant/soft-delete-write để TASK-BE (OUT-OF-SCOPE WO này — plan §OUT-OF-SCOPE).
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_task_comments_task_created
  ON task_comments (company_id, task_id, created_at) WHERE deleted_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DROP TABLE IF EXISTS task_activity_logs CASCADE;
-- DROP TABLE IF EXISTS task_checklist_items CASCADE;
-- DROP TABLE IF EXISTS task_checklists CASCADE;
-- DROP TABLE IF EXISTS task_watchers CASCADE;
-- DROP TABLE IF EXISTS task_assignees CASCADE;
-- ALTER TABLE projects DROP COLUMN IF EXISTS project_code, DROP COLUMN IF EXISTS owner_employee_id,
--   DROP COLUMN IF EXISTS department_id, DROP COLUMN IF EXISTS project_priority, DROP COLUMN IF EXISTS project_status,
--   DROP COLUMN IF EXISTS visibility, DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS closed_at,
--   DROP COLUMN IF EXISTS closed_by, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by,
--   DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS cancelled_by, DROP COLUMN IF EXISTS cancel_reason,
--   DROP COLUMN IF EXISTS progress_percent, DROP COLUMN IF EXISTS metadata, DROP COLUMN IF EXISTS created_by,
--   DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE project_members DROP COLUMN IF EXISTS employee_id, DROP COLUMN IF EXISTS project_role,
--   DROP COLUMN IF EXISTS member_status, DROP COLUMN IF EXISTS joined_at, DROP COLUMN IF EXISTS left_at,
--   DROP COLUMN IF EXISTS invited_by, DROP COLUMN IF EXISTS removed_by, DROP COLUMN IF EXISTS remove_reason,
--   DROP COLUMN IF EXISTS metadata, DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_by,
--   DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE tasks DROP COLUMN IF EXISTS parent_task_id, DROP COLUMN IF EXISTS task_code,
--   DROP COLUMN IF EXISTS reporter_employee_id, DROP COLUMN IF EXISTS creator_user_id,
--   DROP COLUMN IF EXISTS main_assignee_employee_id, DROP COLUMN IF EXISTS department_id,
--   DROP COLUMN IF EXISTS task_priority, DROP COLUMN IF EXISTS task_status, DROP COLUMN IF EXISTS start_at,
--   DROP COLUMN IF EXISTS due_at, DROP COLUMN IF EXISTS estimated_minutes, DROP COLUMN IF EXISTS actual_hours,
--   DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS completed_by, DROP COLUMN IF EXISTS cancelled_at,
--   DROP COLUMN IF EXISTS cancelled_by, DROP COLUMN IF EXISTS cancel_reason, DROP COLUMN IF EXISTS is_locked,
--   DROP COLUMN IF EXISTS sort_order, DROP COLUMN IF EXISTS metadata, DROP COLUMN IF EXISTS created_by,
--   DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE task_comments DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS deleted_at,
--   DROP COLUMN IF EXISTS deleted_by;
