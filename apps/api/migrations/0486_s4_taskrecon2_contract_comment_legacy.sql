-- Migration 0486: S4-TASK-RECON-2 (🔴 RED, zone=red, crown) — CONTRACT pair-drift TASK.
--   Nửa CONTRACT của expand-contract: gỡ grant legacy (comment,'comment') khỏi employee + company-admin.
--   Nguồn sự thật: DB-06 §12.1 (TASK.TASK.COMMENT = (comment,'task')) · docs/plans/S4-TASK-RECON-2.md.
--
-- BỐI CẢNH: mig 0480 (S4-TASK-RECON-1, EXPAND-ONLY) CỐ Ý giữ grant legacy (comment,'comment') SONG SONG
--   grant canonical (comment,'task') để code cũ (còn enforce cặp legacy tới lúc restart) không ăn 403
--   trong khe migrate→restart (Invoke-Migrate KHÔNG stop service). Migration này chạy ở RELEASE SAU,
--   khi ĐIỀU KIỆN TIÊN QUYẾT đã verify (plan §1, 2026-07-10):
--   • grep "'comment', *'comment'" apps/api/src == 0 — KHÔNG route sống nào còn enforce cặp legacy;
--   • code gate (comment,'task') deploy + chạy trên MỌI env (prod 3100 + dev-online 3200, PR #131);
--   • cả 2 DB (mediaos + mediaos_dev) ở head ≥0485 với trạng thái transitional đúng (2 grant song song).
--   ⇒ Grant bị gỡ là grant CHẾT: không mở cửa sổ 403 theo BẤT KỲ thứ tự migrate/deploy nào.
--   ⚠️ RUNBOOK (plan-reviewer): NGAY TRƯỚC khi migrate MỖI env, RE-VERIFY binary đang chạy enforce
--   (comment,'task') — rollback code về trước #131 sẽ enforce lại cặp legacy (xem plan step 6).
--
-- PHẠM VI (CHỈ 2 grant, per-pair):
--   • DELETE role_permissions (comment,'comment') của employee + company-admin (system role).
--   • GIỮ catalog row (comment,'comment'): còn 7 system role media legacy tham chiếu (channel-manager ·
--     editor · hr-manager · project-manager · qa-reviewer · script-writer · uploader — query DB thật
--     2026-07-10; dọn ở WO park riêng) + object_permissions 0 ref. done_when#4: còn tham chiếu ⇒ CHỈ
--     gỡ grant. ⛔ KHÔNG DELETE FROM permissions.
--   • KHÔNG đụng: role media legacy · custom role company-scoped (filter company_id IS NULL không match)
--     · object_permissions · is_sensitive · grant (comment,'task') canonical.
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN DATA: chỉ DELETE role_permissions. KHÔNG DDL, KHÔNG đụng RLS/FORCE/policy/grant của mig 0005
--     → BẤT BIẾN #1 GIỮ NGUYÊN. KHÔNG db:generate (DO-block thủ công).
--   • PER-PAIR DELETE: resolve role_id + permission_id trong DO-block, DELETE đúng bộ
--     (role_id, permission_id, 'ALLOW'). ⛔ KHÔNG blanket theo role_id (mirror 0444/0445/0480 khối park).
--   • App role KHÔNG có UPDATE/DELETE role_permissions ở runtime (mig 0005) — migrator chạy role
--     privileged (DATABASE_DIRECT_URL) → di quyền tại migrate-time (BẤT BIẾN #2 không đụng bảng append-only).
--   • Idempotent: chạy lại → DELETE khớp 0 row (grant đã gỡ). Role/permission thiếu → CONTINUE
--     (DB seed sạch đời sau có thể không còn grant legacy — không có gì để gỡ).
--
-- BAND 0486 (S4-TASK-RECON-2, phiên solo). Journal: idx 166, when 1717500825000 (> head 0485 idx 165 /
--   1717500820000). Nối tiếp ĐƠN ĐIỆU sau 0485_s4_taskseed1_task_perms.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- CONTRACT: gỡ grant legacy (comment,'comment') khỏi employee + company-admin (per-pair DELETE).
-- Mirror khối park (4) của 0480 — resolve từng bộ, KHÔNG blanket, CONTINUE khi thiếu, NOTICE tổng.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- CHỈ 2 system role từng được 0005 cấp cặp legacy mà route sống đã canonical-hoá (PR #131).
  -- Role media legacy (channel-manager/editor/…) giữ nguyên grant — park-list de-media-fy, WO riêng.
  targets CONSTANT text[] := ARRAY['employee', 'company-admin'];
  t           text;
  v_role_id   uuid;
  v_perm_id   uuid;
  v_removed   int := 0;
  v_del       int;
BEGIN
  -- resolve permission legacy (comment,'comment') — catalog row GIỮ NGUYÊN, chỉ cần id để DELETE grant
  SELECT id INTO v_perm_id
    FROM permissions
   WHERE action = 'comment' AND resource_type = 'comment';
  IF v_perm_id IS NULL THEN
    RAISE NOTICE '[0486] catalog không có (comment:comment) — không có grant để contract, bỏ qua';
    RETURN;
  END IF;

  FOREACH t IN ARRAY targets LOOP
    -- resolve role canonical (system role: company_id NULL, chưa xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = t AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      CONTINUE;  -- role không có ⇒ không có grant để gỡ
    END IF;

    -- PER-PAIR DELETE (KHÔNG blanket): chỉ đúng bộ (role_id, permission_id, 'ALLOW').
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW';
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_removed := v_removed + v_del;
  END LOOP;

  RAISE NOTICE '[0486] contract comment:comment — % grant DELETE (per-pair; re-run = 0)', v_removed;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- Chỉ cần khi rollback code về TRƯỚC PR #131 (route enforce lại comment:comment — thực tế không còn đường về).
-- data_scope: 0005 INSERT không chỉ định scope → grant gốc nhận DEFAULT của cột; scope của cặp này vô nghĩa
-- về hành vi (không code nào enforce — grep == 0), INSERT lại với DEFAULT là đủ:
-- INSERT INTO role_permissions (role_id, permission_id, effect)
-- SELECT r.id, p.id, 'ALLOW'
--   FROM roles r CROSS JOIN permissions p
--  WHERE r.name IN ('employee','company-admin') AND r.company_id IS NULL AND r.deleted_at IS NULL
--    AND p.action='comment' AND p.resource_type='comment'
-- ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
