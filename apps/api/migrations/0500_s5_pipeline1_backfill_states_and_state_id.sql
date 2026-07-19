-- Migration 0500: S5-TASK-PIPELINE-1 lane migration (🔴 crown — ĐỔI DỮ LIỆU nghiệp vụ, owner duyệt
--   18/07/2026) — đồng bộ cột pipeline & state_id theo DECISIONS-03 D-20 + DB-06 §4.9/§7.4:
--   (a)  seed 5 state mặc định (tên tiếng Anh, mirror 0420) cho MỌI project đang có 0 state active
--        (project tạo SAU 0420 chưa từng được seed — bẫy M6);
--   (a2) đổi tên 4 cột mặc định tiếng Anh → tiếng Việt (Todo→Cần làm · In Progress→Đang làm ·
--        Done→Hoàn thành · Cancelled→Đã huỷ; Backlog giữ nguyên) — CHỈ đổi đúng cặp (tên cũ,
--        state_group) còn sống, SKIP khi va unique (company_id, project_id, name);
--   (a3) THÊM cột 'Chờ duyệt' (nhóm review, #f59e0b) cho MỌI project chưa có cột nhóm review —
--        chèn TRƯỚC cột hoàn thành đầu tiên + DỒN sort_order tường minh (DB-06 §7.4: review=3,
--        completed=4, cancelled=5 cho bộ mặc định — không chỉ INSERT, nếu không tie-break
--        created_at đẩy cột duyệt ra SAU Hoàn thành);
--   (b)  map tasks.state_id TỪ task_status theo state_group (KHÔNG map theo tên — tên đổi được qua
--        API) với bậc thang D-20 + tie-break XÁC ĐỊNH (sort_order, created_at, id). HEAL cả task
--        state_id NOT NULL đang trỏ cột LỆCH NHÓM (cửa sổ pre-0499: reverse-sync D-21 của lane fsm
--        đặt In Review vào cột default — 0500 là điểm heal duy nhất, plan rev 8).
--
-- BẤT BIẾN DỮ LIỆU (bẫy M2 — mất-dữ-liệu-thị-giác):
--   • task_status IS NULL ⇒ GIỮ NGUYÊN state_id (task trước 0478 được 0420 set state_id đúng từ
--     status legacy; gán is_default sẽ ĐẨY task đã hoàn thành về cột Todo).
--   • Thẻ ĐÃ ở cột đúng nhóm CỦA ĐÚNG PROJECT ⇒ GIỮ NGUYÊN (Todo khớp CẢ unstarted LẪN backlog —
--     không kéo thẻ Backlog về Cần làm); trỏ cột project KHÁC (dữ liệu hỏng) ⇒ heal về project mình.
--     WHERE tường minh, idempotent: chạy lại = 0 hàng.
--   • Project mà MỌI state bị soft-delete ⇒ (a) coi là 0-state và RE-SEED (NOT EXISTS chỉ đếm state
--     sống; partial unique không chặn tên trùng hàng dead) ⇒ task của project đó ĐƯỢC map ở (b).
--     EXISTS-live guard ở (b) thực tế chỉ còn chặn ca project soft-deleted mà task còn sống.
--   • RLS+FORCE của project_states/tasks đã có từ 0420 — KHÔNG tạo lại. Migrator chạy role
--     privileged qua DATABASE_DIRECT_URL; company_id tường minh mọi câu.
--
-- BAND 0500 (S5-TASK-PIPELINE-1). Journal: idx 180, when 1717500895000 (> 0499 idx 179 /
--   1717500890000). Nối tiếp ĐƠN ĐIỆU sau 0499_s5_pipeline1_update_state_perm_review_group.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Seed 5 state mặc định cho project 0-state-active (mirror 0420:230-241; tên tiếng Anh để (a2)
--     đổi một mối). ON CONFLICT DO NOTHING (unique (company_id, project_id, name) WHERE deleted_at
--     IS NULL). CHỈ project chưa có state nào — không nhân đôi/không chèn thêm vào bộ tuỳ biến.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO project_states (company_id, project_id, name, state_group, color, is_default, sort_order)
SELECT p.company_id, p.id, s.name, s.grp, s.color, s.is_default, s.sort_order
FROM projects p
CROSS JOIN (VALUES
  ('Backlog',     'backlog',   '#94a3b8', false, 0),
  ('Todo',        'unstarted', '#64748b', true,  1),
  ('In Progress', 'started',   '#3b82f6', false, 2),
  ('Done',        'completed', '#22c55e', false, 3),
  ('Cancelled',   'cancelled', '#ef4444', false, 4)
) AS s(name, grp, color, is_default, sort_order)
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_states ps
     WHERE ps.company_id = p.company_id AND ps.project_id = p.id AND ps.deleted_at IS NULL
  )
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a2) Đổi tên 4 cột mặc định sang tiếng Việt. Ràng buộc DB-06 §7.4: (1) chỉ cột còn sống + ĐÚNG
--      cặp (tên cũ, state_group) — người dùng có thể đã tự đổi tên, không đổi mù theo tên; (2) SKIP
--      khi project đã có cột trùng tên đích (unique active) — không để migration đổ, không seed đè
--      thành 10 cột; (3) KHÔNG đụng state_group/is_default/sort_order/id — thuần hiển thị.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE project_states ps
SET name = m.new_name, updated_at = now()
FROM (VALUES
  ('Todo',        'unstarted', 'Cần làm'),
  ('In Progress', 'started',   'Đang làm'),
  ('Done',        'completed', 'Hoàn thành'),
  ('Cancelled',   'cancelled', 'Đã huỷ')
) AS m(old_name, grp, new_name)
WHERE ps.name = m.old_name
  AND ps.state_group = m.grp
  AND ps.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_states dup
     WHERE dup.company_id = ps.company_id AND dup.project_id = ps.project_id
       AND dup.deleted_at IS NULL AND dup.name = m.new_name AND dup.id <> ps.id
  );
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a3) Thêm cột 'Chờ duyệt' (review) cho MỌI project chưa có cột nhóm review. Per-project:
--      vị trí chèn = MIN(sort_order) của cột nhóm completed/cancelled (không có ⇒ MAX+1) → DỒN
--      sort_order >= vị-trí +1 → INSERT. Bộ mặc định ra đúng DB-06: review=3, completed=4,
--      cancelled=5. SKIP TOÀN BỘ (không dồn, không chèn) khi project đã có cột TÊN 'Chờ duyệt'
--      khác nhóm (unique active chặn INSERT; dồn rồi fail sẽ drift sort mỗi lần re-run) — project
--      đó dùng bậc thang fallback, ghi release-note. Idempotent: có cột review ⇒ loại khỏi vòng lặp.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t       RECORD;
  v_sort  int;
  v_added int := 0;
BEGIN
  FOR t IN
    SELECT p.company_id, p.id AS project_id
    FROM projects p
    WHERE p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM project_states g
         WHERE g.company_id = p.company_id AND g.project_id = p.id
           AND g.deleted_at IS NULL AND g.state_group = 'review'
      )
      AND NOT EXISTS (
        SELECT 1 FROM project_states n
         WHERE n.company_id = p.company_id AND n.project_id = p.id
           AND n.deleted_at IS NULL AND n.name = 'Chờ duyệt'
      )
  LOOP
    SELECT COALESCE(
      (SELECT MIN(sort_order) FROM project_states
        WHERE company_id = t.company_id AND project_id = t.project_id
          AND deleted_at IS NULL AND state_group IN ('completed', 'cancelled')),
      (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM project_states
        WHERE company_id = t.company_id AND project_id = t.project_id AND deleted_at IS NULL)
    ) INTO v_sort;

    UPDATE project_states
       SET sort_order = sort_order + 1, updated_at = now()
     WHERE company_id = t.company_id AND project_id = t.project_id
       AND deleted_at IS NULL AND sort_order >= v_sort;

    INSERT INTO project_states (company_id, project_id, name, state_group, color, is_default, sort_order)
    VALUES (t.company_id, t.project_id, 'Chờ duyệt', 'review', '#f59e0b', false, v_sort);
    v_added := v_added + 1;
  END LOOP;
  RAISE NOTICE '[0500] a3: thêm cột Chờ duyệt cho % dự án', v_added;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Map tasks.state_id từ task_status theo state_group — bậc thang D-20 (nhóm đích [Todo ưu tiên
--     unstarted rồi backlog] → cột is_default → sort_order nhỏ nhất), tie-break XÁC ĐỊNH
--     ORDER BY sort_order, created_at, id (sort_order mặc định 0 trùng nhau; is_default KHÔNG
--     unique tầng DB). WHERE tường minh: chỉ đụng task (i) state_id NULL HOẶC (ii) đang trỏ cột
--     LỆCH NHÓM so với task_status (heal). task_status NULL ⇒ KHÔNG đụng (M2).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_mapped int;
BEGIN
  UPDATE tasks t
  SET state_id = (
    SELECT ps.id
    FROM project_states ps
    WHERE ps.company_id = t.company_id AND ps.project_id = t.project_id AND ps.deleted_at IS NULL
    ORDER BY
      CASE
        WHEN t.task_status = 'Todo'        AND ps.state_group = 'unstarted' THEN 0
        WHEN t.task_status = 'Todo'        AND ps.state_group = 'backlog'   THEN 1
        WHEN t.task_status = 'In Progress' AND ps.state_group = 'started'   THEN 0
        WHEN t.task_status = 'In Review'   AND ps.state_group = 'review'    THEN 0
        WHEN t.task_status = 'Done'        AND ps.state_group = 'completed' THEN 0
        WHEN t.task_status = 'Cancelled'   AND ps.state_group = 'cancelled' THEN 0
        WHEN ps.is_default THEN 2
        ELSE 3
      END,
      ps.sort_order, ps.created_at, ps.id
    LIMIT 1
  ),
  updated_at = now()
  WHERE t.project_id IS NOT NULL
    AND t.deleted_at IS NULL
    AND t.task_status IN ('Todo', 'In Progress', 'In Review', 'Done', 'Cancelled')
    AND EXISTS (
      SELECT 1 FROM project_states live
       WHERE live.company_id = t.company_id AND live.project_id = t.project_id
         AND live.deleted_at IS NULL
    )
    AND (
      t.state_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM project_states cur
         WHERE cur.id = t.state_id AND cur.company_id = t.company_id
           AND cur.project_id = t.project_id -- cột đúng nhóm nhưng của PROJECT KHÁC vẫn phải heal
           AND cur.deleted_at IS NULL
           AND cur.state_group = ANY (CASE t.task_status
                 WHEN 'Todo'        THEN ARRAY['unstarted', 'backlog']
                 WHEN 'In Progress' THEN ARRAY['started']
                 WHEN 'In Review'   THEN ARRAY['review']
                 WHEN 'Done'        THEN ARRAY['completed']
                 WHEN 'Cancelled'   THEN ARRAY['cancelled']
               END)
      )
    );
  GET DIAGNOSTICS v_mapped = ROW_COUNT;
  RAISE NOTICE '[0500] b: map state_id cho % task (NULL hoặc lệch nhóm)', v_mapped;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c) Verify fail-LOUD (acceptance đợt A): sau (b), 0 task sống có project_id (mà project còn state
--     sống) còn state_id NULL; task Done phải trỏ nhóm completed; In Review phải trỏ nhóm review
--     (KHÔNG phải started). Drift ⇒ RAISE (lộ, không nuốt).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_null      int;
  v_done_bad  int;
  v_rev_bad   int;
BEGIN
  SELECT COUNT(*) INTO v_null
    FROM tasks t
   WHERE t.project_id IS NOT NULL AND t.deleted_at IS NULL
     AND t.task_status IN ('Todo', 'In Progress', 'In Review', 'Done', 'Cancelled')
     AND t.state_id IS NULL
     AND EXISTS (SELECT 1 FROM project_states live
                  WHERE live.company_id = t.company_id AND live.project_id = t.project_id
                    AND live.deleted_at IS NULL);
  IF v_null > 0 THEN
    RAISE EXCEPTION '[0500] verify FAIL: % task có project_id vẫn còn state_id NULL sau map', v_null;
  END IF;

  SELECT COUNT(*) INTO v_done_bad
    FROM tasks t
    JOIN project_states ps ON ps.id = t.state_id AND ps.company_id = t.company_id
   WHERE t.deleted_at IS NULL AND t.task_status = 'Done' AND ps.deleted_at IS NULL
     AND (ps.state_group <> 'completed' OR ps.project_id <> t.project_id)
     AND EXISTS (SELECT 1 FROM project_states c
                  WHERE c.company_id = t.company_id AND c.project_id = t.project_id
                    AND c.deleted_at IS NULL AND c.state_group = 'completed');
  IF v_done_bad > 0 THEN
    RAISE EXCEPTION '[0500] verify FAIL: % task Done không trỏ nhóm completed CỦA ĐÚNG project (dù project có cột completed)', v_done_bad;
  END IF;

  SELECT COUNT(*) INTO v_rev_bad
    FROM tasks t
    JOIN project_states ps ON ps.id = t.state_id AND ps.company_id = t.company_id
   WHERE t.deleted_at IS NULL AND t.task_status = 'In Review' AND ps.deleted_at IS NULL
     AND (ps.state_group <> 'review' OR ps.project_id <> t.project_id)
     AND EXISTS (SELECT 1 FROM project_states c
                  WHERE c.company_id = t.company_id AND c.project_id = t.project_id
                    AND c.deleted_at IS NULL AND c.state_group = 'review');
  IF v_rev_bad > 0 THEN
    RAISE EXCEPTION '[0500] verify FAIL: % task In Review không trỏ nhóm review CỦA ĐÚNG project (dù project có cột review)', v_rev_bad;
  END IF;

  RAISE NOTICE '[0500] verify OK: 0 NULL · Done→completed · In Review→review';
END;
$$;
