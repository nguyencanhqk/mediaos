-- Migration 0483: S4-NOTI-BE-1 — chuẩn hoá delete:notification về Own-scope cho 4 role canonical
--   (mirror 0480/0481 block 4b). DATA-ONLY — KHÔNG DDL, KHÔNG db:generate.
--
-- ⚠ MIGRATION NÀY VỪA EXPAND VỪA CONTRACT — đọc kỹ trước khi sửa:
--   • EXPAND (employee/manager/hr): mig 0481 (4b) grant Own-scope read/mark_read/mark_all_read/hide
--     :notification nhưng BỎ SÓT delete:notification. Không có grant → DELETE /notifications/:id
--     (NOTI-API-106) sẽ 403. Block dưới cấp mới.
--   • CONTRACT (company-admin, và mọi system role khác trúng bulk-grant): mig 0005:310-313 chạy
--     `INSERT INTO role_permissions SELECT <role>, p.id, 'ALLOW' FROM permissions WHERE p.is_sensitive
--     = false` — cặp ('delete','notification', false) ở 0005:270 là non-sensitive nên ĐÃ được cấp.
--     Mig 0441:27 sau đó `ADD COLUMN data_scope NOT NULL DEFAULT 'Company'` ⇒ các grant đó đang ở
--     @Company. Block dưới THU HẸP chúng về @Own (DELETE scope<>'Own' rồi INSERT @Own).
--
-- VÌ SAO THU HẸP AN TOÀN (không có cửa sổ 403 kiểu expand-contract): tại thời điểm mig này,
--   `grep -rn "delete:notification" apps/api/src` == 0 — KHÔNG dòng code nào đang enforce cặp này.
--   Consumer đầu tiên là my-notifications.controller trong CHÍNH commit này, và repository luôn hard-filter
--   `recipient_user_id = user hiện tại` bất kể data_scope, nên Own là ngữ nghĩa đúng (notification là dữ
--   liệu cá nhân — SPEC-08 §16.5.1). company-admin KHÔNG được xoá notification của người khác.
--   ⚠ Nếu tương lai có code enforce delete:notification @Company thì migration này PHẢI tách expand/contract
--   qua 2 release (xem 0480/S4-TASK-RECON-2 làm mẫu).
--
-- LƯU Ý role ngoài 4 canonical (project-manager/channel-manager/… id 002-007) VẪN giữ grant @Company kế
--   thừa từ 0005 — chúng là role hướng-cũ (media), ngoài phạm vi WO này, không dọn ở đây.
--
-- Nguồn chuẩn: DB-07 NOTI/DASH §10.1 liệt kê NOTI.NOTIFICATION.DELETE_OWN TÁCH BIỆT HIDE_OWN
--   (docs/DB thắng khi mâu thuẫn — CLAUDE.md §1; DB-02 §9.7 cũ hơn, chưa liệt kê DELETE_OWN).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9): permission seed hot-file APPEND (ON CONFLICT DO NOTHING),
--   KHÔNG rewrite. KHÔNG đụng RLS/schema — chỉ role_permissions. Idempotent bộ-ba (role_id,permission_id,
--   effect). Per-pair rescope (DELETE scope SAI trước khi INSERT scope đúng) mirror 0480/0481/0444.
--   Chạy lần 1: company-admin re-scope 1 dòng + INSERT; lần 2+: DELETE 0, INSERT ON CONFLICT → không drift.
--
-- BAND 0483 (lane S4-NOTI-BE-1). Journal: idx 163, when 1717500810000 (> head 0482 idx 162 / 1717500805000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  own_roles  CONSTANT text[] := ARRAY['employee', 'manager', 'hr', 'company-admin'];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
  rn         text;
BEGIN
  -- cặp (delete, notification) đã có từ mig 0005 — catalog PHẢI tồn tại trước khi grant.
  SELECT id INTO v_perm_id FROM permissions WHERE action = 'delete' AND resource_type = 'notification';
  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION '[0483] permission (delete:notification) không có trong catalog — mig 0005 phải chạy trước';
  END IF;

  FOREACH rn IN ARRAY own_roles LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = rn AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0483] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', rn;
    END IF;

    -- DELETE đúng bộ (role_id,permission_id,'ALLOW') có scope SAI (per-pair, KHÔNG blanket) → idempotent.
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> 'Own';
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', 'Own')
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0483] own-scope delete:notification grant: % INSERT mới, % re-scope', v_seeded, v_rescoped;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.company_id IS NULL
--     AND r.name IN ('employee','manager','hr','company-admin')
--     AND p.action='delete' AND p.resource_type='notification';
