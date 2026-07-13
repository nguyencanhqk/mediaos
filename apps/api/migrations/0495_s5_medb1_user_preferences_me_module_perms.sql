-- Migration 0495: S5-ME-DB-1 (🔴 RED, zone=red, crown) — user_preferences (DB-08 §8.16 / SPEC-09 §15.2)
--   + seed module ME (DB-10 §10.1) + catalog 5 pair quyền ME + grant scope 'Own' × 4 role canonical.
--   Plan: docs/plans/S5-ME-DB-1.md.
--
-- MỤC TIÊU:
--   (A) BUILD bảng MỚI user_preferences (DB-08 §8.16): tùy chọn cá nhân theo user (tầng User trong
--       precedence setting System → Company → User). company_id NOT NULL. Cột override NULLABLE
--       (NULL = kế thừa company/system default — §15.3/§5.9). UNIQUE(company_id, user_id) = 1 bản ghi/user.
--       KHÔNG deleted_at (upsert-config, KHÔNG soft-delete) ⇒ app GRANT SELECT,INSERT,UPDATE — KHÔNG DELETE.
--   (C) SEED module ME vào modules (DB-10 §10.1): module_group='Experience', sort_order=80, is_active/
--       is_mvp=true, is_core=false. ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING (idempotent).
--   (D) Catalog 5 pair MỚI is_sensitive=false (cổng nav ME → PHẢI non-sensitive để getCapabilities lộ):
--         ('access','me')                       [ME.ACCESS]
--         ('view','user-preference')            [ME.PREFERENCE.VIEW_OWN]
--         ('update','user-preference')          [ME.PREFERENCE.UPDATE_OWN]
--         ('update','avatar')                   [ME.AVATAR.UPDATE_OWN]
--         ('update','notification-preference')  [ME.NOTIFICATION_PREFERENCE.UPDATE_OWN]
--       + grant per-(role,pair) data_scope 'Own' cho CẢ 4 role canonical (employee/manager/hr/company-admin)
--       = 20 role_permissions rows. ME đọc-lại scope Own của CHÍNH user (ME-DEC-002 / SPEC-09 §11.2):
--       KHÔNG seed wrapper cho nghiệp vụ nguồn (ATT/LEAVE/TASK/NOTI/profile) — dùng permission NGUỒN.
--       KHÔNG seed ME.OVERVIEW/PROFILE/ACCOUNT/SESSION/SECURITY_ACTIVITY/DATA_EXPORT (out-of-scope WO này).
--
-- ⚠️ CROSS-USER KHÔNG DO RLS: policy chỉ có GUC app.current_company_id (KHÔNG có app.current_user_id) ⇒
--    RLS+FORCE cô lập TENANT, KHÔNG cô lập user cùng tenant. Chống IDOR cross-user (đọc/ghi pref của user
--    khác cùng company) ép ở ME-BE: WHERE user_id = token-resolved (SPEC-09 §14.4/§17.1). WO này CHỈ đảm bảo
--    tenant-isolation + UNIQUE(company_id,user_id); KHÔNG tự nhận đã chống IDOR cross-user.
--
-- BẤT BIẾN (CLAUDE.md §2/§3):
--   #1 RLS ENABLE + FORCE ROW LEVEL SECURITY + policy tenant_isolation literal-GUC (mẫu 0479
--      notification_delivery_logs — company_id NOT NULL) TẠO TRƯỚC mọi INSERT. Tương thích
--      set_config('app.current_company_id',$1,true) PgBouncer txn-mode (NULLIF(...,'')::uuid).
--   #2 user_preferences = config MUTABLE (upsert theo business key) ⇒ KHÔNG append-only, KHÔNG soft-delete.
--      App SELECT/INSERT/UPDATE — KHÔNG DELETE. Permission seed ON CONFLICT DO NOTHING (hot-file UNION §9.3).
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008).
--   • DDL thủ công (RLS/grant/CHECK/partial-index không biểu diễn được bằng Drizzle) — KHÔNG db:generate.
--   • favorite_modules/me_layout_config KHÔNG chứa secret/dữ liệu nhạy cảm (§8.16 rule 5) — ép ở service.
--
-- BAND 0495 (lane me-preferences-db). Journal: idx 175, when 1717500870000 (> head 0494 idx 174 /
--   1717500865000). Nối tiếp ĐƠN ĐIỆU sau 0494_hr_identity_read_view_identity_perm.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (A) user_preferences (DB-08 §8.16 — tùy chọn cá nhân; company_id NOT NULL) ───────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- company_id NOT NULL + DEFAULT literal-GUC: app khỏi tự set, WITH CHECK vẫn chặn gán sai tenant.
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Cột override NULLABLE (NULL = kế thừa company/system default — §15.3 precedence §5.9).
  locale            varchar(20),
  timezone          varchar(64),
  theme             varchar(20),
  date_format       varchar(30),
  time_format       varchar(10),
  default_landing   varchar(120),
  density           varchar(20),
  favorite_modules  jsonb,
  me_layout_config  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_user_preferences_theme
    CHECK (theme IS NULL OR theme IN ('system', 'light', 'dark')),
  CONSTRAINT chk_user_preferences_density
    CHECK (density IS NULL OR density IN ('comfortable', 'compact')),
  CONSTRAINT chk_user_preferences_time_format
    CHECK (time_format IS NULL OR time_format IN ('12h', '24h'))
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT (CLAUDE.md §3) — literal-GUC policy mẫu 0479 notification_delivery_logs ──
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON user_preferences;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_preferences
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- 1 bản ghi preference / user trong 1 tenant (§8.16 constraint + DB-09 index) — upsert business key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_preferences_company_user
  ON user_preferences (company_id, user_id);
--> statement-breakpoint
-- Config mutable (upsert) — KHÔNG append-only, KHÔNG soft-delete. App SELECT/INSERT/UPDATE — KHÔNG DELETE
-- (BẤT BIẾN #2). worker SELECT (đọc pref cho job nền — vd render TZ/locale trong notification).
GRANT SELECT, INSERT, UPDATE ON user_preferences TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON user_preferences TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── (C) SEED module ME (DB-10 §10.1). ON CONFLICT (uq module_code chưa soft-delete) ──────────
--     mirror 0435: Experience group, sort_order=80, is_active/is_mvp=true, is_core=false. Idempotent.
INSERT INTO modules (module_code, name, module_group, is_core, is_mvp, is_active, sort_order) VALUES
  ('ME', 'Trung tâm cá nhân', 'Experience', false, true, true, 80)
ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (D) Catalog 5 pair ME is_sensitive=false. ON CONFLICT(action,resource_type) DO NOTHING ──
--     (hot-file UNION §9.3). is_sensitive=false: access:me = cổng nav ME (getCapabilities lọc bỏ sensitive);
--     view/update:user-preference/avatar/notification-preference = thao tác Own của chính user.
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('access', 'me',                      false),  -- ME.ACCESS
  ('view',   'user-preference',         false),  -- ME.PREFERENCE.VIEW_OWN
  ('update', 'user-preference',         false),  -- ME.PREFERENCE.UPDATE_OWN
  ('update', 'avatar',                  false),  -- ME.AVATAR.UPDATE_OWN
  ('update', 'notification-preference', false)   -- ME.NOTIFICATION_PREFERENCE.UPDATE_OWN
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── Grant scope 'Own' × 4 role canonical × 5 pair = 20 role_permissions (§13 per-role) ──────
--     mirror 0485/0444 DO-block: resolve role THEO THUỘC TÍNH (name + company_id IS NULL + deleted_at IS NULL
--     — KHÔNG hard-code id, KHÔNG INSERT...SELECT blanket, bài học §13 + blanket-grant-role-drift) →
--     per-pair DELETE-wrong-scope (giữ grant khác nếu scope <> 'Own') → INSERT ON CONFLICT(role,perm,effect)
--     DO NOTHING. UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE+INSERT.
--     Idempotent bộ-ba (role, permission, 'Own'): chạy lại = no-op.
DO $$
DECLARE
  roles_arr CONSTANT text[] := ARRAY['employee', 'manager', 'hr', 'company-admin'];
  pairs     CONSTANT text[][] := ARRAY[
    ['access', 'me'],
    ['view',   'user-preference'],
    ['update', 'user-preference'],
    ['update', 'avatar'],
    ['update', 'notification-preference']
  ];
  r_name     text;
  pr         text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_del      int;
BEGIN
  FOREACH r_name IN ARRAY roles_arr LOOP
    -- resolve role canonical (system role: company_id NULL, chưa xoá mềm) — fail-LOUD
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = r_name AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0495] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', r_name;
    END IF;

    FOREACH pr SLICE 1 IN ARRAY pairs LOOP
      -- resolve permission (bước (D) phải đã chạy) — fail-LOUD
      SELECT id INTO v_perm_id
        FROM permissions
       WHERE action = pr[1] AND resource_type = pr[2];
      IF v_perm_id IS NULL THEN
        RAISE EXCEPTION '[0495] permission (%:%) không có trong catalog — bước (D) trượt', pr[1], pr[2];
      END IF;

      -- per-pair DELETE đúng bộ (role_id,permission_id,'ALLOW') có scope SAI (<> 'Own') — KHÔNG blanket.
      DELETE FROM role_permissions
       WHERE role_id = v_role_id
         AND permission_id = v_perm_id
         AND effect = 'ALLOW'
         AND data_scope <> 'Own';

      INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
      VALUES (v_role_id, v_perm_id, 'ALLOW', 'Own')
      ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
      GET DIAGNOSTICS v_del = ROW_COUNT;
      v_seeded := v_seeded + v_del;
    END LOOP;
  END LOOP;

  RAISE NOTICE '[0495] ME grants: % INSERT mới (4 role × 5 pair @ Own)', v_seeded;
END;
$$;
--> statement-breakpoint

-- ─────────────── Verify fail-LOUD (mẫu 0466/0476): module ME + ĐÚNG 5 pair + ĐÚNG 20 grant Own ──────────
DO $$
DECLARE
  v_n int;
BEGIN
  -- module ME (Experience, sort_order 80, active) tồn tại sau seed
  IF NOT EXISTS (
    SELECT 1 FROM modules
     WHERE module_code = 'ME' AND deleted_at IS NULL
       AND is_active = true AND module_group = 'Experience' AND sort_order = 80
  ) THEN
    RAISE EXCEPTION '[0495] verify: module ME (Experience, sort_order 80, active) không tồn tại sau seed';
  END IF;

  -- ĐÚNG 5 pair ME trong catalog
  SELECT COUNT(*) INTO v_n
    FROM permissions
   WHERE (action, resource_type) IN (
     ('access', 'me'), ('view', 'user-preference'), ('update', 'user-preference'),
     ('update', 'avatar'), ('update', 'notification-preference')
   );
  IF v_n <> 5 THEN
    RAISE EXCEPTION '[0495] verify: catalog có % pair ME, kỳ vọng 5 — bước (D) trượt', v_n;
  END IF;

  -- 5 pair ME PHẢI non-sensitive (cổng nav ME: getCapabilities lọc bỏ mọi sensitive)
  IF EXISTS (
    SELECT 1 FROM permissions
     WHERE (action, resource_type) IN (
       ('access', 'me'), ('view', 'user-preference'), ('update', 'user-preference'),
       ('update', 'avatar'), ('update', 'notification-preference')
     ) AND is_sensitive = true
  ) THEN
    RAISE EXCEPTION '[0495] verify: có pair ME mang is_sensitive=true — vỡ cổng nav ME';
  END IF;

  -- ĐÚNG 20 grant ALLOW × Own cho 4 role canonical trên tập 5 pair ME (§13 per-role, chống over/under-grant)
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr', 'company-admin')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND rp.data_scope = 'Own'
     AND (p.action, p.resource_type) IN (
       ('access', 'me'), ('view', 'user-preference'), ('update', 'user-preference'),
       ('update', 'avatar'), ('update', 'notification-preference')
     );
  IF v_n <> 20 THEN
    RAISE EXCEPTION '[0495] verify: % grant ME Own cho 4 role canonical, kỳ vọng 20 — over/under-grant (drift?)', v_n;
  END IF;

  RAISE NOTICE '[0495] verify PASS: module ME + 5 pair non-sensitive + 20 grant Own (4 role × 5 pair)';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id
--     AND (p.action, p.resource_type) IN
--       (('access','me'),('view','user-preference'),('update','user-preference'),
--        ('update','avatar'),('update','notification-preference'));
-- DELETE FROM permissions WHERE (action, resource_type) IN
--   (('access','me'),('view','user-preference'),('update','user-preference'),
--    ('update','avatar'),('update','notification-preference'));
-- DELETE FROM modules WHERE module_code = 'ME';
-- DROP TABLE IF EXISTS user_preferences CASCADE;
