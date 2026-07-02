-- Migration 0465: S2-HR-BE-6 scope FIX (owner-chốt 2026-07-02, session 1849d064, harness/handoff.md
--   §"Quyết định người-chốt chờ áp dụng" + PR #78) — seed grant RIÊNG view:contract cho employee(Own) +
--   manager(Team), GIỮ NGUYÊN hr/company-admin ở Company (mig 0462). manage:contract KHÔNG đổi (vẫn chỉ
--   hr/company-admin @ Company — employee/manager KHÔNG được create/update/delete/link-file hợp đồng).
--
-- LÝ DO: mig 0462 seed SAI so với kỳ vọng ban đầu (SCOPE CHỐT ghi nhầm "employee/manager KHÔNG có Own/
--   Team" → GET /hr/contracts và GET /hr/employees/:id/contracts trả 403 cho CHÍNH employee xem hợp đồng
--   của mình / manager xem hợp đồng team mình). Quyết định người-chốt: GIỮ kỳ vọng ban đầu — employee xem
--   ĐƯỢC hợp đồng CHÍNH MÌNH (Own), manager xem ĐƯỢC hợp đồng TEAM mình (Team, S2-INT-2 multi-manager
--   pattern qua DataScopeService — KHÔNG viết logic scope mới).
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ per-pair DELETE
--     wrong-scope + INSERT target (mirror 0462/0459). App role KHÔNG UPDATE role_permissions ⇒ đổi scope
--     qua DELETE+INSERT (BẤT BIẾN #2). KHÔNG blanket UPDATE toàn bảng.
--   • Canonical role employee/manager: company_id NULL, seed 0444 (đã tồn tại — KHÔNG tạo role mới).
--   • permission (view,contract) catalog đã seed ở mig 0462 (ON CONFLICT DO NOTHING) — KHÔNG seed lại catalog.
--   • KHÔNG đổi grant hr/company-admin (Company) — giữ nguyên hành vi hiện có, test happy-path cũ vẫn xanh.
--
-- BAND 0465 (lane batch6 / db-migration). Journal: idx 145, when 1717500720000 (> head 0464 idx 144 /
--   1717500715000). NỐI TIẾP ĐƠN ĐIỆU forward-only/no-gap sau head thực tế (verify _journal.json).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    -- HR.CONTRACT.VIEW — bổ sung Own/Team (FIX). hr/company-admin @ Company KHÔNG động tới ở migration này.
    ['employee', 'view', 'contract', 'Own'],
    ['manager',  'view', 'contract', 'Team']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role (system role canonical: company_id NULL, không xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0465] role canonical % không tồn tại — seed 0444 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog đã seed ở mig 0462)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0465] permission (%:%) không có trong catalog — mig 0462 phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI (per-pair, KHÔNG blanket).
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- INSERT lại scope target. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0465] CONTRACT view scope fix: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('employee','manager') AND r.company_id IS NULL
--     AND (p.action,p.resource_type) = ('view','contract');
