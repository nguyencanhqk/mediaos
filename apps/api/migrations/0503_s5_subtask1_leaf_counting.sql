-- S5-TASK-SUBTASK-1 (DECISIONS-05 D-34) — mv_dashboard_task_status ĐẾM LÁ.
-- Band 0503, nối tiếp 0502 (D-30 canonical status). KHÔNG có DDL cột: `parent_task_id` đã tồn tại từ
-- 0478 kèm CHECK (parent_task_id <> id); WO này là nơi ĐẦU TIÊN dùng nó.
--
-- "LÁ" = task deleted_at IS NULL và KHÔNG có COUNTABLE_CHILD, trong đó COUNTABLE_CHILD = con còn sống
-- và task_status <> 'Cancelled'. Task không có việc con ⇒ chính nó là lá. Nói cách khác: task có việc
-- con thì CHỈ ĐẾM CON, không đếm cả cha lẫn con.
--
-- ⚠️ VÌ SAO LOẠI 'Cancelled' KHỎI VỊ TỪ LÁ (D-32 — đừng "dọn dẹp" thành `deleted_at IS NULL` cho gọn):
-- nếu con Cancelled vẫn tính là con, thì một task CHA đang Todo & QUÁ HẠN mà có ĐÚNG 1 việc con đã huỷ
-- sẽ rớt khỏi mọi con số ⇒ dashboard hiện "0 việc phải làm, 0 quá hạn" trong khi cha vẫn sống và trễ
-- hạn. Việc đã huỷ KHÔNG được che khuất việc còn sống.
-- Vị từ CẤU TRÚC (xoá lan, luật độ sâu) thì NGƯỢC LẠI — có tính con Cancelled; xem
-- `activeChildExists`/`countableChildExists`/`isLeaf` ở apps/api/src/tasks/task-core.repository.ts.
-- Hai bản (SQL ở đây ↔ hàm TS ở đó) KHÔNG có ràng buộc cơ học nào giữ khớp nhau — SỬA MỘT BÊN PHẢI SỬA
-- BÊN KIA; int-spec "ba nguồn số khớp nhau" (MV · báo cáo dự án · widget project-progress) là lưới an toàn.
--
-- HỆ QUẢ SỐ LIỆU ĐÃ ĐƯỢC OWNER CHẤP NHẬN (ghi ở DECISIONS-05 D-34, KHÔNG phải bug — đừng "sửa lại"):
--   1. tổng nhảy không đều: thêm việc con ĐẦU TIÊN ⇒ tổng KHÔNG đổi (cha rời tập lá, con vào);
--      việc con THỨ HAI mới +1;
--   2. board (chỉ hiện cha) ≠ báo cáo (chỉ đếm lá) trên cùng một dự án;
--   3. người CHỈ ôm task cha hiện activeCount = 0 trên biểu đồ tải;
--   4. huỷ việc con CUỐI CÙNG làm tổng TĂNG 1 (cha hết COUNTABLE_CHILD nên quay lại làm lá).
--
-- CÔNG THỨC CANONICAL D-30 GIỮ NGUYÊN TỪNG CHỮ từ 0502 (chỉ THÊM vị từ lá). Map legacy:
--   not_started→Todo · in_progress→In Progress · waiting_review→In Review
--   revision→In Progress · approved→Done · completed→Done · ngoài bảng map → giữ RAW (fail-visible).
--
-- SECURITY NOTE (giữ nguyên từ 0102/0502): MV KHÔNG có RLS — chứa dữ liệu MỌI tenant; service PHẢI
-- WHERE company_id = $current khi đọc. Cột ĐẦU = company_id.
--
-- Số đếm dashboard sẽ ĐỔI ngay sau migrate với tenant đã có việc con — CÓ CHỦ ĐÍCH theo D-34.
--
-- ROLLBACK (đường lùi viết sẵn — đây là đổi ngữ nghĩa số liệu người dùng nhìn thấy): bỏ đúng khối
-- `AND NOT EXISTS (...)` bên dưới rồi DROP + CREATE lại là quay về hành vi 0502; index và grant giữ nguyên.

-- ── BACKSTOP CROSS-TENANT Ở TẦNG DB (BẤT BIẾN #1 — CLAUDE.md đòi ép ở DB, không dựa kỷ luật dev) ──
-- FK hiện tại `parent_task_id REFERENCES tasks(id)` (0478) KHÔNG mang company_id, và RI-check của
-- Postgres BỎ QUA RLS ⇒ trước migration này chỉ app-check giữ cho cha/con cùng tenant.
-- ĐÃ ĐO TRƯỚC KHI LÀM (điều kiện của plan): `SELECT count(*) FROM tasks` = 114 hàng ⇒ build UNIQUE
-- index + validate FK trong migration là chuyện của mili-giây, không khoá bảng đáng kể.
-- FK cũ GIỮ NGUYÊN (không DROP) — hai ràng buộc cùng tồn tại, cái mới chặt hơn.
ALTER TABLE tasks ADD CONSTRAINT tasks_id_company_uq UNIQUE (id, company_id);
--> statement-breakpoint

-- ⚠️ `ON DELETE SET NULL (parent_task_id)` — DANH SÁCH CỘT LÀ BẮT BUỘC, KHÔNG được bỏ.
-- `ON DELETE SET NULL` trần set NULL cho MỌI cột tham chiếu, tức cả `company_id`:
--   UPDATE ONLY tasks SET parent_task_id = NULL, company_id = NULL WHERE ...
-- mà `tasks.company_id` là NOT NULL (0008) ⇒ hard-DELETE một task cha sẽ NỔ
-- "null value in column company_id violates not-null constraint".
-- Hôm nay lỗi đó BỊ CHE bởi FK cũ (0478) chạy trước và set parent_task_id = NULL, làm WHERE của
-- trigger mới khớp 0 hàng — nhưng thứ tự nổ trigger RI là sort CHUỖI tên `RI_ConstraintTrigger_a_<oid>`,
-- nên chỉ cần OID vượt mốc luỹ thừa 10 là thứ tự đảo và hard-delete vỡ. Không được dựa vào đó.
-- Hard-delete CÓ thật trên đường test: apps/api/test/helpers/seed.ts teardown dùng DELETE.
ALTER TABLE tasks ADD CONSTRAINT tasks_parent_same_company_fk
  FOREIGN KEY (parent_task_id, company_id)
  REFERENCES tasks (id, company_id)
  ON DELETE SET NULL (parent_task_id);
--> statement-breakpoint

-- Index phục vụ vị từ lá + aggregate tiến độ (countSubtaskProgressByParentIdsTx dùng `= ANY`).
-- Postgres KHÔNG tự index FK ⇒ thiếu index này là seq-scan theo parent_task_id.
-- (Build MV toàn bảng nhiều khả năng vẫn chọn hash anti-join — lợi ích thật nằm ở truy vấn per-project.)
-- PARTIAL trên `parent_task_id IS NOT NULL` — KHÔNG chỉ `deleted_at IS NULL`. Vế trong của anti-join
-- lá chỉ quan tâm các hàng CÓ cha; thiếu vị từ này, index cond rút về `company_id = ...` và mỗi lần
-- đánh giá phải đi hết task còn sống CỦA CẢ TENANT — chi phí theo quy mô TENANT chứ không theo dự án
-- (đo trên 40k hàng tenant / 400 hàng dự án: 769 buffer · 1.31ms → 4 buffer · 0.21ms).
-- Planner vẫn suy ra được `IS NOT NULL` từ điều kiện bằng nên `= ANY` và EXISTS tương quan vẫn dùng index.
CREATE INDEX IF NOT EXISTS tasks_parent_active_idx
  ON tasks (company_id, parent_task_id)
  WHERE deleted_at IS NULL AND parent_task_id IS NOT NULL;
--> statement-breakpoint

DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_task_status;
--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_dashboard_task_status AS
SELECT
  t.company_id,
  COALESCE(
    t.task_status,
    CASE t.status
      WHEN 'not_started'    THEN 'Todo'
      WHEN 'in_progress'    THEN 'In Progress'
      WHEN 'waiting_review' THEN 'In Review'
      WHEN 'revision'       THEN 'In Progress'
      WHEN 'approved'       THEN 'Done'
      WHEN 'completed'      THEN 'Done'
      ELSE t.status
    END
  ) AS status,
  COUNT(*)::bigint AS task_count
FROM tasks t
WHERE t.deleted_at IS NULL
  -- D-34 — chỉ đếm LÁ (xem đầu file về việc loại 'Cancelled').
  AND NOT EXISTS (
    SELECT 1
      FROM tasks c
     WHERE c.parent_task_id = t.id
       AND c.company_id     = t.company_id
       AND c.deleted_at IS NULL
       AND c.task_status IS DISTINCT FROM 'Cancelled'
  )
-- GROUP BY positional (2) — GIỮ NGUYÊN từ 0502, KHÔNG đổi thành tên cột:
--   alias `status` TRÙNG tên cột input `tasks.status`; GROUP BY theo tên bị Postgres phân giải về CỘT
--   INPUT ⇒ hard-error. Ordinal còn BẮT BUỘC để 2 giá trị legacy cùng map (approved+completed→Done)
--   GỘP 1 hàng — nếu không, unique index (company_id,status) build fail duplicate-key.
GROUP BY t.company_id, 2
WITH DATA;
--> statement-breakpoint

-- UNIQUE INDEX cột TRẦN — điều kiện sống của REFRESH CONCURRENTLY (index biểu thức KHÔNG đủ điều kiện).
CREATE UNIQUE INDEX mv_dashboard_task_status_uq
  ON mv_dashboard_task_status (company_id, status);
--> statement-breakpoint

CREATE INDEX mv_dashboard_task_status_company_idx
  ON mv_dashboard_task_status (company_id);
--> statement-breakpoint

-- DROP làm mất GRANT ⇒ cấp lại theo trạng thái CUỐI của 0102+0103+0502: app SELECT + worker SELECT.
-- (0103 đã REVOKE ALL worker xuống SELECT — KHÔNG grant ALL lại.)
-- ⚠️ KHÔNG "sửa" refresh bằng ALTER OWNER cho mediaos_worker: worker không có BYPASSRLS và tasks bật
-- FORCE RLS ⇒ MV sẽ REFRESH ra RỖNG LẶNG LẼ. Nợ G14 này thuộc WO riêng, không vá ở đây.
GRANT SELECT ON mv_dashboard_task_status TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON mv_dashboard_task_status TO mediaos_worker;
