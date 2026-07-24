-- Migration 0526: S5-GOAL-DB-2 (🔴 RED, zone=red, crown) — Đợt D: task_templates + task_template_items
--   (DB-11 §6.3/§6.4). Header template phân rã mục tiêu → task (DB-06 §3.3 chừa chỗ, kích hoạt tại đây).
--
-- MỤC TIÊU (plan docs/plans/S5-GOAL-DB-2.md §1):
--   BUILD 2 bảng MỚI:
--     • task_templates      — header template (name/description/department scope/is_active). company_id
--                             NOT NULL. RLS+FORCE + policy literal-GUC. soft-delete. UNIQUE (company,name)
--                             partial-active. FK department_id → org_units ON DELETE SET NULL (NULL = template
--                             dùng chung công ty; xoá phòng ⇒ template thành dùng-chung, KHÔNG xoá/vỡ CHECK).
--     • task_template_items — từng task mẫu trong template (title/priority/estimate/checklist/sort_order).
--                             FK template_id → task_templates ON DELETE CASCADE (item là con — xoá cứng
--                             template kéo item; thực tế soft-delete ở service). default_priority CHECK theo
--                             task priority THẬT (DB-06 §8.5 = workflow.ts:480: urgent/high/medium/low/none).
--
-- ⚠️ BẢN ĐỒ TÊN DB-11 → QUAN HỆ THẬT: departments → org_units. `task-template` (gạch-nối) là resource_type
--    quyền ở 0527; `task_template` (gạch-dưới) là audit object_type ở 0528 — KHÔNG lẫn.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS ENABLE + FORCE + policy tenant_isolation literal-GUC TẠO TRƯỚC mọi INSERT (WO này KHÔNG seed data
--      hàng). Policy NGUYÊN VĂN mẫu 0479/0504: USING+WITH CHECK (company_id = NULLIF(current_setting
--      ('app.current_company_id', true), '')::uuid). NULLIF + `, true` bắt buộc. rls-coverage-assert soi GUC
--      cho MỌI bảng company_id ⇒ 2 bảng này tự vào lưới; rls-guards đòi có case trong rls-registry.
--   #2 KHÔNG bảng nào append-only — cả 2 soft-delete (deleted_at) ⇒ GRANT app SELECT,INSERT,UPDATE (đánh dấu
--      xoá = UPDATE), KHÔNG DELETE. worker SELECT (mirror task-core 0478 + goals 0504).
--   #3 template KHÔNG lưu secret/PII — name/title/description là dữ liệu nghiệp vụ thường (ép ở service).
--   #5 UUID PK gen_random_uuid() · timestamptz UTC-at-rest · soft-delete deleted_at/by.
--   • DDL thủ công (RLS/grant/CHECK/partial-index không biểu diễn được bằng Drizzle) — KHÔNG db:generate
--     (sẽ DROP schema media/finance đang park). schema/task-templates.ts là PARITY-only.
--   • FK ON DELETE: company CASCADE + template_id CASCADE (con); department_id SET NULL (anchor mềm);
--     audit-user created/updated/deleted_by SET NULL.
--
-- BAND 0526 (lane S5-GOAL-DB-2). Journal: idx 193, when 1717587315000 (> head 0525 idx 192 / 1717587314000).
--   Nối tiếp ĐƠN ĐIỆU sau 0525_s5_goaldash1_widget_goal_progress. Số 0508/0509 đã bị wave LMS chiếm.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── 1. task_templates (DB-11 §6.3 — header template; company_id NOT NULL) ───────────────
CREATE TABLE IF NOT EXISTS task_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL
                   DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                   REFERENCES companies(id) ON DELETE CASCADE,
  name           varchar(255) NOT NULL,
  description    text,
  -- template của phòng; NULL = dùng chung công ty. SET NULL: xoá cứng phòng ⇒ template thành dùng-chung.
  department_id  uuid REFERENCES org_units(id) ON DELETE SET NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at     timestamptz,
  deleted_by     uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT (CLAUDE.md §3) — literal-GUC policy mẫu 0479/0504 (company_id NOT NULL) ──
ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON task_templates;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON task_templates
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Index (DB-11 §6.3): unique tên/company (chưa xoá) + partial theo phòng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_templates_company_name
  ON task_templates (company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_task_templates_company_dept
  ON task_templates (company_id, department_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- soft-delete: App SELECT/INSERT/UPDATE — KHÔNG DELETE (BẤT BIẾN #2). worker SELECT.
GRANT SELECT, INSERT, UPDATE ON task_templates TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON task_templates TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 2. task_template_items (DB-11 §6.4 — task mẫu; company_id NOT NULL) ───────────────
CREATE TABLE IF NOT EXISTS task_template_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  template_id       uuid NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  title             varchar(500) NOT NULL,
  description       text,
  default_priority  varchar(50),
  estimate_hours    numeric(8, 2),
  -- mảng string checklist → map vào task_checklists khi áp (TPL-1). Không ép shape ở DB (nghiệp vụ ở service).
  checklist         jsonb,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  -- priority = null (dùng default lúc áp) hoặc 1 trong 5 giá trị task priority (DB-06 §8.5 / workflow.ts:480).
  CONSTRAINT chk_task_template_items_priority
    CHECK (default_priority IS NULL OR default_priority IN ('urgent', 'high', 'medium', 'low', 'none'))
);
--> statement-breakpoint
ALTER TABLE task_template_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_template_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON task_template_items;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON task_template_items
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_task_template_items_tpl
  ON task_template_items (company_id, template_id, sort_order) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON task_template_items TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON task_template_items TO mediaos_worker;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DROP TABLE IF EXISTS task_template_items CASCADE;
-- DROP TABLE IF EXISTS task_templates CASCADE;
