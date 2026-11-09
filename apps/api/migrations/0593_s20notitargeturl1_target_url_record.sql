-- Migration 0593: S20-NOTI-TARGETURL-1 (RED, zone=red) — template target_url mở ĐÚNG bản ghi.
--   THUẦN DATA (UPDATE in-place notification_templates.target_url_template). KHÔNG DDL/RLS/grant/policy,
--   KHÔNG chạm `notifications` đã phát (đích cũ vẫn mở được: trang danh sách). Khuôn: 0497.
--   Nối tiếp head 0592 (idx 259) -> 0593 (idx 260, when 1717587382000).
--
--   Đích (chỉ IN_APP vi-VN):
--     TASK_DUE_SOON / TASK_OVERDUE        /tasks/my-tasks              -> /tasks/{taskId}
--     TASK_COMMENT_CREATED / TASK_MENTIONED /tasks/{taskId}            -> /tasks/{taskId}?comment_id={commentId}
--     LEAVE_REQUEST_SUBMITTED (người duyệt) /leave/approvals           -> /leave/approvals?request={requestId}
--   Template gửi CHỦ đơn (APPROVED/REJECTED/CANCELLED/REVOKED) GIỮ /leave/me/requests/{requestId}.
--   Khoá payload có thật: taskId (job nhắc hạn thêm cùng PR) · taskId+commentId (commentPayload) · requestId.
--
--   Bất biến: #1 không đụng cô lập tenant (migrator owner-bypass; hàng override theo công ty chỉ đổi cột
--   chuỗi route non-sensitive) · #2 không hard-delete, không đổi id · #3 không secret.
--   IDEMPOTENT + KHÔNG ĐÈ SỬA TAY: predicate = giá trị CŨ chính xác (đích 0497) ⇒ chạy lại 0 hàng đổi.
--   Override theo công ty: copy-on-write chép đích cũ ⇒ cập nhật theo dấu vân tay (giữ updated_by, giữ
--   hàng xoá mềm, giữ override tuỳ biến). Số override đã cập nhật + số bị GIỮ in qua RAISE NOTICE.
--
-- Rollback (runbook — chạy TRƯỚC `m prod-rollback`, rồi chạy câu kiểm tra, kỳ vọng 0 hàng):
--   UPDATE notification_templates SET target_url_template = '/tasks/my-tasks', updated_at = now()
--    WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
--      AND template_code IN ('TASK_DUE_SOON__IN_APP__vi-VN','TASK_OVERDUE__IN_APP__vi-VN')
--      AND target_url_template = '/tasks/{taskId}';
--   UPDATE notification_templates SET target_url_template = '/tasks/{taskId}', updated_at = now()
--    WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
--      AND template_code IN ('TASK_COMMENT_CREATED__IN_APP__vi-VN','TASK_MENTIONED__IN_APP__vi-VN')
--      AND target_url_template = '/tasks/{taskId}?comment_id={commentId}';
--   UPDATE notification_templates SET target_url_template = '/leave/approvals', updated_at = now()
--    WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
--      AND template_code = 'LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN'
--      AND target_url_template = '/leave/approvals?request={requestId}';
--   -- Kiểm tra: SELECT template_code, company_id IS NULL, target_url_template FROM notification_templates
--   --  WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
--   --    AND (target_url_template IN ('/tasks/{taskId}?comment_id={commentId}','/leave/approvals?request={requestId}')
--   --         OR (template_code IN ('TASK_DUE_SOON__IN_APP__vi-VN','TASK_OVERDUE__IN_APP__vi-VN')
--   --             AND target_url_template = '/tasks/{taskId}'));
--   Down KHÔNG xoá hàng drizzle.__drizzle_migrations: lên lại mã mới ⇒ chạy tay khối Up hoặc ra 0594.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

DO $$
DECLARE
  r record;
  v_n int;
  v_total int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('TASK_DUE_SOON__IN_APP__vi-VN',          '/tasks/my-tasks',    '/tasks/{taskId}'),
      ('TASK_OVERDUE__IN_APP__vi-VN',           '/tasks/my-tasks',    '/tasks/{taskId}'),
      ('TASK_COMMENT_CREATED__IN_APP__vi-VN',   '/tasks/{taskId}',    '/tasks/{taskId}?comment_id={commentId}'),
      ('TASK_MENTIONED__IN_APP__vi-VN',         '/tasks/{taskId}',    '/tasks/{taskId}?comment_id={commentId}'),
      ('LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN','/leave/approvals',   '/leave/approvals?request={requestId}')
    ) AS v(code, old_url, new_url)
  LOOP
    -- (1) GLOBAL: chỉ đổi khi còn đúng đích cũ (không đè sửa tay).
    UPDATE notification_templates
       SET target_url_template = r.new_url, updated_at = now()
     WHERE company_id IS NULL AND deleted_at IS NULL
       AND template_code = r.code AND channel = 'IN_APP' AND locale = 'vi-VN'
       AND target_url_template = r.old_url;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- (2) OVERRIDE theo công ty còn mang đích cũ (bản chép copy-on-write): đổi theo; KHÔNG đổi updated_by.
    UPDATE notification_templates
       SET target_url_template = r.new_url, updated_at = now()
     WHERE company_id IS NOT NULL AND deleted_at IS NULL
       AND template_code = r.code AND channel = 'IN_APP' AND locale = 'vi-VN'
       AND target_url_template = r.old_url;
    GET DIAGNOSTICS v_total = ROW_COUNT;
    RAISE NOTICE '[0593] % : global đổi % hàng, override đổi % hàng', r.code, v_n, v_total;

    -- (3) VERIFY fail-LOUD.
    SELECT count(*) INTO v_n FROM notification_templates
     WHERE company_id IS NULL AND deleted_at IS NULL AND template_code = r.code
       AND channel = 'IN_APP' AND locale = 'vi-VN' AND target_url_template = r.old_url;
    IF v_n > 0 THEN
      RAISE EXCEPTION '[0593] % : % hàng global còn đích cũ % (UPDATE không áp được)', r.code, v_n, r.old_url;
    END IF;

    SELECT count(*) INTO v_n FROM notification_templates
     WHERE company_id IS NULL AND deleted_at IS NULL AND template_code = r.code
       AND channel = 'IN_APP' AND locale = 'vi-VN';
    IF v_n = 0 THEN
      RAISE EXCEPTION '[0593] % : thiếu template global (seed 0481 hỏng) — chặn deploy', r.code;
    END IF;

    -- (4) Hàng global active mang giá trị KHÁC cả cũ lẫn mới (sửa tay) ⇒ NOTICE, không ném.
    SELECT count(*) INTO v_n FROM notification_templates
     WHERE company_id IS NULL AND deleted_at IS NULL AND template_code = r.code
       AND channel = 'IN_APP' AND locale = 'vi-VN' AND target_url_template IS DISTINCT FROM r.new_url;
    IF v_n > 0 THEN
      RAISE NOTICE '[0593] % : % hàng global mang giá trị tuỳ biến (GIỮ nguyên)', r.code, v_n;
    END IF;
    SELECT count(*) INTO v_n FROM notification_templates
     WHERE company_id IS NOT NULL AND deleted_at IS NULL AND template_code = r.code
       AND channel = 'IN_APP' AND locale = 'vi-VN' AND target_url_template IS DISTINCT FROM r.new_url;
    IF v_n > 0 THEN
      RAISE NOTICE '[0593] % : % override công ty mang đích tuỳ biến (GIỮ nguyên)', r.code, v_n;
    END IF;
  END LOOP;
END;
$$;
