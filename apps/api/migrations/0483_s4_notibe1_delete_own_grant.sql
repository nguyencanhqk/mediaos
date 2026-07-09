-- Migration 0483: S4-NOTI-BE-1 — grant own-scope delete:notification cho 4 role canonical (pair-drift fix,
--   mirror 0480/0481 block 4b). THUẦN ADDITIVE DATA — KHÔNG DDL, KHÔNG db:generate.
--
-- BỐI CẢNH: mig 0481 (4b) đã grant Own-scope read/mark_read/mark_all_read/hide:notification cho
--   employee/manager/hr/company-admin nhưng KHÔNG grant delete:notification — DELETE /notifications/:id
--   (NOTI-API-106, S4-NOTI-BE-1) sẽ 403 cho MỌI role dù cặp (delete,notification) đã có sẵn trong catalog
--   từ mig 0005. Nguồn chuẩn: DB-07 NOTI/DASH §10.1 liệt kê NOTI.NOTIFICATION.DELETE_OWN TÁCH BIỆT
--   HIDE_OWN (docs/DB thắng khi mâu thuẫn — CLAUDE.md §1; DB-02 §9.7 cũ hơn, chưa liệt kê DELETE_OWN).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9): permission seed hot-file APPEND (ON CONFLICT DO NOTHING),
--   KHÔNG rewrite. KHÔNG đụng RLS/schema — chỉ role_permissions. Idempotent bộ-ba (role_id,permission_id,
--   effect). Per-pair rescope (DELETE scope SAI trước khi INSERT scope đúng) mirror 0480/0481/0444.
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
