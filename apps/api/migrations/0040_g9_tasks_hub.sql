-- Migration 0040: G9-1 — Chuẩn hoá `tasks` thành Task Hub hợp nhất (BẤT BIẾN #4).
-- Gate: FULL (security-reviewer + database-reviewer + silent-failure-hunter).
--
-- MỤC TIÊU: 1 bảng `tasks` nhận đủ 7 nguồn việc (production·review·revision·meeting_action·
--   office·finance·hr) + GIỮ 'workflow_step' để tương thích ngược (G4/G7 đang emit loại này).
--   Cho phép task NON-VIDEO: project_id / content_item_id / workflow_instance_id đều nullable.
--
-- QUYẾT ĐỊNH RECONCILE (ADR-0024): MỞ RỘNG CHECK (thêm production/review/revision) + GIỮ
--   'workflow_step' — KHÔNG data-migration 'workflow_step'→'production'. Lý do: dữ liệu cũ + outbox
--   replay (tasks_dedup_key_uq) phụ thuộc cặp (workflow_step_id, revision_round); đổi task_type hàng
--   loạt là thao tác có rủi ro, không cần thiết cho mục tiêu G9 (board lọc theo task_type vẫn chạy).
--
-- AN TOÀN MIGRATION (CLAUDE.md §6):
--   • `tasks` ĐÃ có RLS + FORCE + policy + grants (0008). Đây chỉ là ADD COLUMN + nới CHECK + INDEX
--     → KHÔNG cần backfill company_id, KHÔNG có cửa sổ rò chéo tenant (cột mới nullable, default cũ giữ).
--   • Cột mới kế thừa RLS của bảng; app-role grants (SELECT/INSERT/UPDATE/DELETE) không đổi.
--   • Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
--   • Append-only (BẤT BIẾN #2) áp cho *app-role DML*, KHÔNG phải migration DDL → DROP/ADD CHECK hợp lệ
--     (tiền lệ 0011/0014/0020 cho audit_logs_object_type_chk).
-- ⚠️ Journal: idx 38 / when 1717500050000 (> 1717500045000 — đỉnh created_at của DB đã ở 0037 sau khi
--   G7 land master; migrator drizzle chỉ apply entry có when STRICTLY GREATER max(created_at)) → KHÔNG skip.
-- ⚠️ Dải số lane G9 = 0040–0049 (tránh đụng filename lane khác); renumber này cấp lúc rebase lên master 6a0d4bd (G9 land #1).

-- 1. workflow_instance_id (nullable) — liên kết task với 1 vòng workflow (ngoài workflow_step lẻ).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS workflow_instance_id uuid
    REFERENCES workflow_instances (id) ON DELETE SET NULL;
--> statement-breakpoint

-- 2. project_id (nullable) — task gắn dự án (My/Team/Project Tasks — G9-4).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS project_id uuid
    REFERENCES projects (id) ON DELETE SET NULL;
--> statement-breakpoint

-- 3. Nới CHECK task_type: 5 loại cũ → 8 loại (7 spec + workflow_step back-compat).
--    Tên constraint inline 0008 = 'tasks_task_type_check' ({table}_{column}_check mặc định của PG).
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
--> statement-breakpoint
ALTER TABLE tasks
  ADD CONSTRAINT tasks_task_type_check CHECK (task_type IN (
    'workflow_step',
    'production',
    'review',
    'revision',
    'meeting_action',
    'office',
    'finance',
    'hr'
  ));
--> statement-breakpoint

-- 4. Index hỗ trợ lọc board theo project + workflow-instance.
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tasks_workflow_instance_id_idx ON tasks (workflow_instance_id);

-- -------- Down (manual) --------
-- DROP INDEX IF EXISTS tasks_workflow_instance_id_idx;
-- DROP INDEX IF EXISTS tasks_project_id_idx;
-- ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
-- ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (task_type IN
--   ('workflow_step','office','meeting_action','hr','finance'));   -- ⚠ chỉ an toàn nếu chưa có row dùng loại mới
-- ALTER TABLE tasks DROP COLUMN IF EXISTS project_id;
-- ALTER TABLE tasks DROP COLUMN IF EXISTS workflow_instance_id;
