-- Migration 0590: S16-SOCIAL-BE-3C (🔴 RED, crown) — SEED cặp `restore:feed-post` + 2 grant.
--   THUẦN DATA — khuôn `0476` (restore:* per-role theo tên) + `0578` (verify fail-loud). KHÔNG db:generate.
--   Plan `docs/plans/S16-SOCIAL-BE-3C.md` §1 O1 · D1 · D3.
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0578): migrator chạy DATABASE_DIRECT_URL = role owner
--   (rolbypassrls) ⇒ INSERT `permissions` (global) + `role_permissions` (vai hệ thống company_id NULL) chạy
--   TRỰC TIẾP. RLS chỉ chặn app role runtime.
--
-- QUYẾT ĐỊNH (owner ký O1, 28/09/2026): cặp MỚI, KHÔNG tái dùng `manage:feed-post`. Khôi phục bài từ thùng
--   rác là một năng lực tách được khỏi «ẩn/xoá bài người khác»: vai tuỳ biến chỉ giữ `manage:feed-post` KHÔNG
--   khôi phục được (int-spec D2c). Cấp ĐÚNG tập vai đang giữ `manage:feed-post` (`0578:94-95`: `hr` +
--   `company-admin`), scope `Company` — verify (c) bên dưới SO HAI TẬP, không đếm trần.
--
-- `is_sensitive = false` (D1) — nhất quán với 14 cặp `feed-*` và SOC-DEC-004. KHÁC `restore:employee` /
--   `restore:user` (`true`, mig 0350/0476) vì hai cặp đó hồi sinh PII/credential; khôi phục bài là kiểm duyệt
--   NỘI DUNG, đảo ngược được, và luật D4/O4 đưa mọi ca mơ hồ về `hidden`.
--   ⚠️ HỆ QUẢ WILDCARD (ghi API-19 §5.1k, PIN bằng int-spec W1): vai mang `*:*` (engine `permission.decide.ts`
--   Priority 4) và `super-admin` (bootstrap cấp toàn catalog @System mỗi lần boot) TỰ nhận cặp này — y hệt
--   `manage:feed-post` hôm nay. Đổi sang `true` là ĐỔI SPEC (phá SOC-DEC-004) ⇒ ngoài phạm vi WO.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§9): `permissions` ON CONFLICT (action,resource_type) DO NOTHING ·
--   `role_permissions` ON CONFLICT (role_id,permission_id,effect) DO NOTHING ⇒ chạy lại KHÔNG nhân đôi.
--   Resolve vai THEO THUỘC TÍNH (tên + company_id NULL + is_system), KHÔNG hard-code id.
--
-- ⚠️ PHẠM VI SỞ HỮU của verify (`invariant-count-must-filter-owned-rows`): file này chỉ ghi vào vai HỆ THỐNG
--   (`company_id IS NULL`) ⇒ mọi đếm lọc `company_id IS NULL AND name <> 'super-admin'`. Vai tuỳ biến của
--   tenant (fixture int-spec, tenant admin thật) KHÔNG thuộc tầm với của file này — đếm chúng là RAISE oan
--   và chặn migrate trên chính môi trường thật (bài học đã ghi ở `s16-social-db1-invariants.int-spec.ts`).
--
-- BAND 0590 (lane S16-SOCIAL-BE-3C). Journal: idx 257, when 1717587379000 (> 0589 idx 256 / 1717587378000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (a) Catalog: 1 cặp. ON CONFLICT DO NOTHING (hot-file: append, không rewrite) ──
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('restore', 'feed-post', false)   -- SOCIAL.POST.RESTORE — khôi phục bài từ thùng rác (SOCIAL-API-057/058)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (b) Grant per-role — ĐÚNG tập vai giữ `manage:feed-post` (0578:94-95), @Company ──
DO $$
DECLARE
  v_roles   CONSTANT text[] := ARRAY['hr', 'company-admin'];
  v_name    text;
  v_role_id uuid;
  v_perm_id uuid;
  v_seeded  int := 0;
  v_n       int;
BEGIN
  SELECT id INTO v_perm_id
    FROM permissions
   WHERE action = 'restore' AND resource_type = 'feed-post';
  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION '[0590] permission restore:feed-post khong co trong catalog — buoc (a) phai chay truoc';
  END IF;

  FOREACH v_name IN ARRAY v_roles LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = v_name AND company_id IS NULL AND is_system = true AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0590] role canonical % khong ton tai — seed 0005/0444 phai chay truoc', v_name;
    END IF;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', 'Company')
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_seeded := v_seeded + v_n;
  END LOOP;

  RAISE NOTICE '[0590] restore:feed-post: % grant INSERT moi (ky vong 2 lan dau, 0 khi chay lai)', v_seeded;
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (c) VERIFY fail-LOUD (RAISE EXCEPTION — khuôn 0578). Idempotent: chạy lại PASS, count không đổi.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n            int;
  v_bad          text;
  v_restore_set  text[];
  v_manage_set   text[];
BEGIN
  -- (c1) cặp tồn tại, ĐÚNG MỘT hàng, `is_sensitive = false` (D1).
  SELECT count(*) INTO v_n
    FROM permissions
   WHERE action = 'restore' AND resource_type = 'feed-post' AND is_sensitive = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0590] verify: restore:feed-post is_sensitive=false dem duoc % — ky vong 1 (D1)', v_n;
  END IF;

  -- (c2) ĐÚNG 2 grant ALLOW @Company trên vai HỆ THỐNG (phạm vi sở hữu — xem header).
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.action = 'restore' AND p.resource_type = 'feed-post'
     AND ro.company_id IS NULL AND ro.name <> 'super-admin' AND ro.deleted_at IS NULL
     AND rp.effect = 'ALLOW';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '[0590] verify: % grant restore:feed-post tren vai he thong, ky vong 2 (hr + company-admin)', v_n;
  END IF;
  SELECT string_agg(format('%s [%s]', ro.name, rp.data_scope), ' ; ') INTO v_bad
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.action = 'restore' AND p.resource_type = 'feed-post'
     AND ro.company_id IS NULL AND ro.name <> 'super-admin' AND ro.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND rp.data_scope <> 'Company';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0590] verify: grant restore:feed-post scope ngoai Company: %', v_bad;
  END IF;

  -- (c3) TẬP vai giữ `restore:feed-post` = TẬP vai giữ `manage:feed-post` (O1) — so hai mảng đã ORDER BY,
  --      KHÔNG so số đếm: đổi vai giữ nguyên số lượng là hồi quy im lặng.
  --      ⚠️ NEO CHỐNG XANH-RỖNG: hai tập rỗng cũng bằng nhau (`NULL IS NOT DISTINCT FROM NULL`) ⇒ (c2) ở trên
  --      đã ép tập restore có đúng 2 phần tử; ở đây ép thêm tập manage KHÔNG rỗng.
  SELECT array_agg(ro.name::text ORDER BY ro.name) INTO v_restore_set
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.action = 'restore' AND p.resource_type = 'feed-post'
     AND ro.company_id IS NULL AND ro.name <> 'super-admin' AND ro.deleted_at IS NULL
     AND rp.effect = 'ALLOW';
  SELECT array_agg(ro.name::text ORDER BY ro.name) INTO v_manage_set
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.action = 'manage' AND p.resource_type = 'feed-post'
     AND ro.company_id IS NULL AND ro.name <> 'super-admin' AND ro.deleted_at IS NULL
     AND rp.effect = 'ALLOW';
  IF COALESCE(array_length(v_manage_set, 1), 0) = 0 THEN
    RAISE EXCEPTION '[0590] verify: KHONG vai he thong nao giu manage:feed-post — 0578 chua chay?';
  END IF;
  IF v_restore_set IS DISTINCT FROM v_manage_set THEN
    RAISE EXCEPTION '[0590] verify: tap vai restore:feed-post (%) KHAC tap manage:feed-post (%) — O1',
      COALESCE(array_to_string(v_restore_set, ','), '<NULL>'),
      COALESCE(array_to_string(v_manage_set, ','), '<NULL>');
  END IF;

  -- (c4) 4 vai hệ thống ngoài nhận 0 hàng (least privilege — khuôn 0578 (f)).
  SELECT string_agg(ro.name::text, ' ; ') INTO v_bad
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.action = 'restore' AND p.resource_type = 'feed-post'
     AND ro.name IN ('payroll-officer', 'recruiter', 'asset-manager', 'office-admin')
     AND ro.company_id IS NULL AND ro.deleted_at IS NULL AND rp.effect = 'ALLOW';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0590] verify: vai he thong ngoai tap O1 nhan restore:feed-post: %', v_bad;
  END IF;

  -- (c5) 0 hàng `object_permissions` trỏ cặp — hình dạng bypass MẠNH NHẤT (khuôn 0578 (i)).
  SELECT string_agg(format('%s/%s', op.subject_type, op.subject_id), ' ; ') INTO v_bad
    FROM object_permissions op
    JOIN permissions p ON p.id = op.permission_id
   WHERE p.action = 'restore' AND p.resource_type = 'feed-post';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0590] verify: co object_permissions tro restore:feed-post (bypass cong quyen): %', v_bad;
  END IF;

  RAISE NOTICE '[0590] verify PASS: restore:feed-post (is_sensitive=false) · 2 grant @Company = tap manage:feed-post · 0 vai ngoai · 0 object_permissions';
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id AND p.action = 'restore' AND p.resource_type = 'feed-post';
-- DELETE FROM permissions WHERE action = 'restore' AND resource_type = 'feed-post';
