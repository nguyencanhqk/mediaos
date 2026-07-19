-- S5-DASH-TASKSTATUS-FIX-1 (DECISIONS-03 D-30): mv_dashboard_task_status đếm theo trạng thái CANONICAL.
-- Band 0502. Bug CÓ SẴN từ G14 (mig 0102): MV GROUP BY cột `status` LEGACY — luồng task core (0478+)
-- CHỈ ghi `task_status` TitleCase ⇒ mọi task văn phòng hiện đại bị đếm 'not_started' vĩnh viễn.
--
-- Công thức mới: COALESCE(task_status, map(status legacy)) — một cột canonical, taxonomy hiện đại
-- (Todo · In Progress · In Review · Done · Cancelled). Map legacy (ADR D-30):
--   not_started→Todo · in_progress→In Progress · waiting_review→In Review
--   revision→In Progress (bị trả về làm lại = đang xử lý) · approved→Done · completed→Done
--   giá trị NGOÀI bảng map → giữ RAW (fail-visible, không gộp câm).
--
-- SECURITY NOTE (giữ nguyên từ 0102): MV KHÔNG có RLS — chứa dữ liệu MỌI tenant; service PHẢI
-- WHERE company_id = $current khi đọc. Cột ĐẦU = company_id.
--
-- mv_dashboard_output GIỮ NGUYÊN (media-era, PARKED de-media-fy — D-30 hệ quả #2, không sửa ở đây).
--
-- DROP + CREATE ... WITH DATA chạy TRONG transaction của drizzle migrator ⇒ atomic với reader MỚI
-- (statement mới chờ ACCESS EXCLUSIVE rồi thấy MV mới; tx dài mở sẵn có thể dính stale-OID — cửa sổ
-- deploy, chấp nhận). WITH DATA populate ngay trong migrate (done_when "refresh lại sau migrate";
-- REFRESH thường trong tx hợp lệ, CONCURRENTLY thì KHÔNG — nên không dùng ở đây).

DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_task_status;
--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_dashboard_task_status AS
SELECT
  company_id,
  COALESCE(
    task_status,
    CASE status
      WHEN 'not_started'    THEN 'Todo'
      WHEN 'in_progress'    THEN 'In Progress'
      WHEN 'waiting_review' THEN 'In Review'
      WHEN 'revision'       THEN 'In Progress'
      WHEN 'approved'       THEN 'Done'
      WHEN 'completed'      THEN 'Done'
      ELSE status
    END
  ) AS status,
  COUNT(*)::bigint AS task_count
FROM tasks
WHERE deleted_at IS NULL
-- GROUP BY positional (2): alias `status` TRÙNG tên cột input `tasks.status` — GROUP BY theo tên bị
-- Postgres phân giải về CỘT INPUT ⇒ hard-error "task_status must appear in the GROUP BY" (fail-loud,
-- nhưng vẫn là sai). Ordinal còn BẮT BUỘC để 2 legacy cùng map (approved+completed→Done) GỘP 1 hàng —
-- nếu không unique index (company_id,status) build fail duplicate-key. Đừng "dọn dẹp" thành tên.
GROUP BY company_id, 2
WITH DATA;
--> statement-breakpoint

-- UNIQUE INDEX cột trần (company_id, status) — REFRESH CONCURRENTLY yêu cầu unique index CHỈ gồm tên
-- cột (index biểu thức KHÔNG đủ điều kiện). Cột status mới không bao giờ NULL (status legacy NOT NULL
-- + CASE có ELSE) ⇒ index phủ đủ hàng.
CREATE UNIQUE INDEX mv_dashboard_task_status_uq
  ON mv_dashboard_task_status (company_id, status);
--> statement-breakpoint

CREATE INDEX mv_dashboard_task_status_company_idx
  ON mv_dashboard_task_status (company_id);
--> statement-breakpoint

-- DROP làm mất GRANT ⇒ cấp lại theo trạng thái CUỐI của 0102+0103: app SELECT + worker SELECT
-- (0103 đã REVOKE ALL worker xuống SELECT — KHÔNG grant ALL lại; REFRESH chạy bằng owner qua
-- direct/worker pool như cũ).
GRANT SELECT ON mv_dashboard_task_status TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON mv_dashboard_task_status TO mediaos_worker;
