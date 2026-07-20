-- Migration 0505: S5-GOAL-DB-1 (🔴 RED, zone=red) — liên kết đo tiến độ TASK↔GOAL (DB-11 §6.5).
--
-- MỤC TIÊU (plan M2): ALTER tasks ADD goal_id (nullable) + FK ĐƠN CỘT ON DELETE SET NULL + index partial.
--   Mode 'tasks' (GOAL-DEC-006): tiến độ goal đếm task Done gắn goal_id. Gắn/tháo là hành động service (không
--   ép FK chéo company/assignee ở DB — kiểm tại thời điểm gắn, GOAL-ERR-008). KHÔNG backfill (cột mới, NULL).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3):
--   #1 KHÔNG đụng RLS/policy tasks (đã ENABLE+FORCE từ 0478) — chỉ ADD cột + FK + index. Tenant isolation tasks
--      giữ nguyên. goal_id là cột thường (đo), lọc theo company_id có sẵn.
--   #2 FK goal_id → goals(id) ON DELETE SET NULL — ĐƠN CỘT (bẫy SET NULL composite #247: FK nhiều cột SET NULL
--      không hợp lệ khi 1 cột NOT NULL). Xoá cứng goal ⇒ task rớt liên kết (goal_id NULL), company_id KHÔNG đổi.
--   • Idempotent: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS trước ADD CONSTRAINT (ADD CONSTRAINT
--     KHÔNG có IF NOT EXISTS trong Postgres) + CREATE INDEX IF NOT EXISTS. Thuần DDL — KHÔNG db:generate.
--
-- BAND 0505 (lane S5-GOAL-DB-1). Journal: idx 185, when 1717587307000 (> 0504 idx 184 / 1717587306000).
--   Nối tiếp ĐƠN ĐIỆU sau 0504_s5_goaldb1_goal_core (goals PHẢI tồn tại trước khi FK tới).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS goal_id uuid;
--> statement-breakpoint
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS fk_tasks_goal;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_goal
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_company_goal
  ON tasks (company_id, goal_id) WHERE goal_id IS NOT NULL AND deleted_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DROP INDEX IF EXISTS idx_tasks_company_goal;
-- ALTER TABLE tasks DROP CONSTRAINT IF EXISTS fk_tasks_goal;
-- ALTER TABLE tasks DROP COLUMN IF EXISTS goal_id;
