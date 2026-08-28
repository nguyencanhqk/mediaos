-- S10-CLEAN-WORKFLOWCLUSTER-2 · KI-082 — DROP cụm bảng workflow/approval (di sản hướng media)
--
-- DESTRUCTIVE-APPROVED: gỡ 14 bảng + 4 cột FK chết của cụm workflow/approval đã hết hộ tiêu thụ;
-- dữ liệu ĐO ĐƯỢC = 0 hàng trên CẢ 14 bảng, code đọc chúng đã gỡ ở commit TRƯỚC (owner Cian,
-- 2026-08-28, WO S10-CLEAN-WORKFLOWCLUSTER-2)
--
-- ── VÌ SAO ─────────────────────────────────────────────────────────────────────────────────────
-- CLAUDE.md §1 (reframe 2026-06-20) đưa module media/workflow-DAG ra NGOÀI phạm vi sản phẩm.
-- `S10-CLEAN-WORKFLOWPARK-1` gỡ 29 route `/workflow*`; sau đó census đo được **0 hộ gọi**
-- `createInstance`/`createInstanceForTemplate`/`createApprovalRequest` trong toàn `src/` ⇒ cụm bảng
-- này KHÔNG còn đường code nào sinh ra dữ liệu. Commit CODE liền trước file này đã gỡ nốt
-- `approval/` + engine + mọi đường ĐỌC (expand-contract: code ngừng đọc TRƯỚC, cột rơi SAU).
--
-- ── SỐ ĐO TRƯỚC KHI CHẠY (đo 2026-08-28 trên DB `mediaos` — PROD + dev-online DÙNG CHUNG) ───────
--   • 14 bảng bị DROP: **0 hàng / mỗi bảng** (workflow_definitions · workflow_definition_steps ·
--     workflow_instances · workflow_steps · workflow_step_dependencies · workflow_step_checklist_states ·
--     workflow_step_instance_locks · step_transitions · checklists · checklist_items ·
--     approval_requests · approval_steps · approval_rules · defects).
--   • `tasks` (bảng SỐNG): 12 hàng · **0** hàng có `workflow_step_id` NOT NULL · **0** hàng có
--     `workflow_instance_id` NOT NULL · **0** hàng `task_type='workflow_step'`.
--   • `evaluation_results` 0 hàng · `bonus_penalties` 0 hàng.
--   • Không TRIGGER, không VIEW/MATVIEW nào phụ thuộc 14 bảng (đo bằng pg_depend/pg_trigger).
--     RLS policy của chúng rơi theo DROP TABLE — không cần gỡ tay.
--   ⇒ File này KHÔNG mất dữ liệu nghiệp vụ nào. Nếu số hàng khác 0 khi bạn đọc lại, DỪNG và đo lại.
--
-- ── THỨ TỰ CÓ CHỦ ĐÍCH ─────────────────────────────────────────────────────────────────────────
-- (1) gỡ cột FK trên bảng NGOÀI cụm trước — nếu không DROP TABLE sẽ đòi CASCADE, và CASCADE sẽ
--     ÂM THẦM gỡ thứ ta chưa liệt kê. Ở đây KHÔNG dùng CASCADE ở bất kỳ đâu: một phụ thuộc ngoài
--     danh sách PHẢI làm migration ĐỎ chứ không được biến mất lặng lẽ.
-- (2) DROP 14 bảng trong MỘT câu lệnh: `checklists` ⇄ `workflow_definition_steps` phụ thuộc VÒNG
--     (checklists.workflow_definition_step_id ↔ workflow_definition_steps.default_checklist_id),
--     nên không tồn tại thứ tự tuần tự nào hợp lệ. Postgres tự giải vòng trong cùng một câu.
-- (3) gỡ 27 cặp quyền mồ côi + 89 grant. Xoá `role_permissions` TRƯỚC `permissions`.
--
-- ⚠️ BẪY ĐÃ TRÁNH: `ALTER TABLE ... DROP COLUMN` của Postgres gỡ THEO cả CHECK constraint nào tham
-- chiếu cột đó, KHÔNG cảnh báo. Quét trước khi viết file này (pg_constraint contype='c' trên 3 bảng
-- bị chạm) chỉ ra ĐÚNG MỘT nạn nhân: `bonus_penalties_reference_check`. `tasks` và
-- `evaluation_results` không có CHECK nào chạm cột bị gỡ ⇒ hai bảng đó DROP trần là an toàn.

--> statement-breakpoint
-- ── (1) Bảng SỐNG `tasks`: gỡ 2 cột + 3 index của hướng cũ ─────────────────────────────────────
-- `tasks_dedup_key_uq` neo trên `workflow_step_id` (chống sinh trùng khi replay outbox của workflow
-- engine). Engine đó không còn ⇒ unique này không còn ý nghĩa và không thể tồn tại khi cột rơi.
DROP INDEX IF EXISTS tasks_dedup_key_uq;
--> statement-breakpoint
DROP INDEX IF EXISTS tasks_workflow_step_id_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS tasks_workflow_instance_id_idx;
--> statement-breakpoint
ALTER TABLE tasks DROP COLUMN IF EXISTS workflow_step_id;
--> statement-breakpoint
ALTER TABLE tasks DROP COLUMN IF EXISTS workflow_instance_id;
--> statement-breakpoint

-- ── (1b) Bảng PARK ngoài cụm: gỡ cột FK trỏ vào cụm ────────────────────────────────────────────
ALTER TABLE evaluation_results DROP COLUMN IF EXISTS workflow_step_id;
--> statement-breakpoint
-- ⛔ `bonus_penalties.defect_id` KHÔNG được DROP trần: Postgres GỠ LUÔN mọi CHECK tham chiếu cột bị
-- xoá, và `bonus_penalties_reference_check` (bất biến "reference đúng-một-hoặc-không") tham chiếu nó.
-- DROP trần ⇒ bảng MẤT bất biến mà migration xanh, lint xanh, test xanh — đúng loại lỗ không lưới nào
-- bắt được. Nên: DROP constraint TƯỜNG MINH → DROP cột → DỰNG LẠI constraint không còn vế `defect`.
ALTER TABLE bonus_penalties DROP CONSTRAINT IF EXISTS bonus_penalties_reference_check;
--> statement-breakpoint
ALTER TABLE bonus_penalties DROP COLUMN IF EXISTS defect_id;
--> statement-breakpoint
ALTER TABLE bonus_penalties
  ADD CONSTRAINT bonus_penalties_reference_check CHECK (
    CASE
      WHEN reference_type IS NULL         THEN (task_id IS NULL AND kpi_result_id IS NULL)
      WHEN reference_type = 'task'        THEN (task_id       IS NOT NULL AND kpi_result_id IS NULL)
      WHEN reference_type = 'kpi_result'  THEN (kpi_result_id IS NOT NULL AND task_id       IS NULL)
      ELSE false
    END
  );
--> statement-breakpoint
-- `source`/`reference_type` không còn nhận 'defect' — nếu để nguyên thì CHECK reference ở trên sẽ
-- ném ELSE false cho mọi hàng source='defect', tức thông báo lỗi trỏ sai chỗ. Siết ở đúng cột.
ALTER TABLE bonus_penalties DROP CONSTRAINT IF EXISTS bonus_penalties_source_check;
--> statement-breakpoint
ALTER TABLE bonus_penalties
  ADD CONSTRAINT bonus_penalties_source_check CHECK (source IN ('manual','kpi'));
--> statement-breakpoint

-- ── (2) DROP 14 bảng — MỘT câu, KHÔNG CASCADE ──────────────────────────────────────────────────
DROP TABLE IF EXISTS
  workflow_step_checklist_states,
  workflow_step_instance_locks,
  approval_steps,
  approval_requests,
  approval_rules,
  defects,
  workflow_step_dependencies,
  checklist_items,
  checklists,
  workflow_definition_steps,
  step_transitions,
  workflow_steps,
  workflow_instances,
  workflow_definitions;
--> statement-breakpoint

-- ── (3) Catalog quyền: gỡ cặp mồ côi ───────────────────────────────────────────────────────────
-- 5 resource_type gắn CHẶT với bảng vừa DROP: approval-request (approval_requests) ·
-- workflow-instance (workflow_instances) · workflow-template (workflow_definitions) ·
-- defect (defects) · step (workflow_steps).
-- ⛔ KHÔNG đụng 'channel' / 'content' / 'project' / 'platform-account': bảng của chúng VẪN CÒN
-- (park, ngoài phạm vi WO này) và `auth-seed-canonical-roles.int-spec` §F đo grant park > 0 trên
-- tập đó — xoá nhầm sẽ làm cổng chống blanket-DELETE mất ý nghĩa.
DELETE FROM role_permissions
 WHERE permission_id IN (
   SELECT id FROM permissions
    WHERE resource_type IN ('approval-request','workflow-instance','workflow-template','defect','step')
 );
--> statement-breakpoint
DELETE FROM object_permissions
 WHERE permission_id IN (
   SELECT id FROM permissions
    WHERE resource_type IN ('approval-request','workflow-instance','workflow-template','defect','step')
 );
--> statement-breakpoint
DELETE FROM permissions
 WHERE resource_type IN ('approval-request','workflow-instance','workflow-template','defect','step');
