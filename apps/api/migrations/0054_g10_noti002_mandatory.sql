-- Migration 0054: NOTI-002 — Mandatory notification rule enforcement.
--
-- LANE: G10 band 0050–0059. Journal: idx=82, when=1717500170000 (> master max 1717500160000).
--
-- Thêm cột `mandatory boolean NOT NULL DEFAULT false` vào notification_rules.
-- Bảng vẫn append-only: app role chỉ INSERT/SELECT.
-- Đánh dấu mandatory = INSERT row mới qua admin/seed path (không nới GRANT UPDATE rộng).
-- Partial index WHERE mandatory=true để lookup nhanh.
--
-- Bất biến (CLAUDE.md §2 + TASKS.md §1):
--   1. company_id MỌI query — RLS+FORCE đã bật sẵn cho notification_rules.
--   2. notification_rules append-only — KHÔNG thêm GRANT UPDATE/DELETE.
--   3. audit_logs CHECK không thay đổi (không thêm action mới cần CHECK ràng buộc).

ALTER TABLE notification_rules
  ADD COLUMN mandatory boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Partial index để lookup mandatory=true nhanh (WHERE company_id=... AND mandatory=true).
CREATE INDEX notification_rules_mandatory_idx
  ON notification_rules (company_id, notification_type)
  WHERE mandatory = true;
