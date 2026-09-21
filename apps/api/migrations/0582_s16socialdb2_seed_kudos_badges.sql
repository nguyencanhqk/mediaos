-- Migration 0582: S16-SOCIAL-DB-2 (🔴 RED, zone=red, crown) — SEED catalog huy hiệu vinh danh
--   (DB-17 §7.9 · plan docs/plans/S16-SOCIAL-DB-2.md §2 D2/D3 + §3): 5 mã hệ thống cho MỌI công ty
--   ĐANG TỒN TẠI lúc migrate. THUẦN DATA VIẾT TAY — KHÔNG `db:generate`.
--
-- D3 — ĐÚNG 5 MÃ (DB-17 §7.9 là nguồn duy nhất liệt kê tên cụ thể): teamwork · innovation ·
--   customer-first · mentor · above-beyond. (`done_when` cũ ghi "≥6" nhưng KHÔNG neo vào danh sách 6
--   mã nào — phát minh mã thứ sáu không căn cứ thiết kế tệ hơn sửa con số trong backlog; backlog sửa
--   cùng PR.) `icon` là tên icon lucide (khớp packages/ui) — mỹ quan thuần tuý, FE đổi sau bằng
--   UPDATE (bảng CÓ GRANT UPDATE), không cần migration mới.
--
-- D2 — PHƯƠNG ÁN (a): migration chỉ với tay tới công ty ĐANG TỒN TẠI. `feed_kudos_badges` là catalog
--   PER-COMPANY (company_id NOT NULL + UNIQUE(company_id,code)) ⇒ công ty tạo SAU file này phải được
--   một `ModuleMasterDataSeeder` runtime lo. Seeder đó sống ở `apps/api/src/social/**` (module NestJS,
--   onModuleInit) — NGOÀI `paths` của DB-2 ⇒ ghi NỢ cho S16-SOCIAL-BE-2: đăng ký `social.master-data`
--   ở `MasterDataSeederRegistry` (foundation/seed/master-data-seeder.registry.ts).
--
-- 🔴 FILE NÀY TUYỆT ĐỐI KHÔNG `RAISE` KHI `companies` RỖNG (plan §3, đã kiểm chứng):
--   KHÔNG migration nào INSERT company; company chỉ sinh ở BOOT APP (ensure-default-company.service.ts)
--   hoặc FIXTURE TEST (test/helpers/seed.ts). `lane-db-setup.sh --reset` = DROP → CREATE DATABASE →
--   chain 0000→latest bằng `tsx src/db/migrate.ts`, KHÔNG boot app ⇒ lúc file này chạy, `companies`
--   = 0 hàng. Một RAISE ở đây làm ĐỎ TOÀN BỘ chain migrate trên MỌI DB mới: lane DB, CI (DB mới mỗi
--   job), và một cài đặt PROD mới. ⇒ file này là **no-op có bảo đảm** trên mọi môi trường test.
--   Neo chống-rỗng (empty-success-is-the-fail-open-shape) nằm ở int-spec — nơi có company THẬT
--   (plan §7 Nhóm 13) — KHÔNG ở migration.
--
-- ⚠️ ĐẲNG THỨC VERIFY PHẢI LỌC THEO PHẠM VI SỞ HỮU (invariant-count-must-filter-owned-rows):
--   đếm TOÀN BẢNG là sai hình dạng — bảng có GRANT INSERT cho app role (BE-3 cho tenant admin tự tạo
--   huy hiệu riêng), int-spec §7 Nhóm 13 dựng hàng, và công ty soft-delete SAU khi seed đều làm vế
--   trái > vế phải ⇒ RAISE OAN ở đường chạy-lại mà chính plan §7 Nhóm 10 bắt buộc.
--   Vế trái = CHỈ 5 mã hệ thống, CHỈ trên công ty CÒN SỐNG.
--
-- RLS: `feed_kudos_badges` có ENABLE + FORCE ROW LEVEL SECURITY từ 0580. Migrator chạy bằng vai
--   SUPERUSER/BYPASSRLS (DATABASE_DIRECT_URL) ⇒ INSERT/SELECT ở đây không bị policy chặn. Đường ghi
--   của ứng dụng (mediaos_app) vẫn bị lọc `app.current_company_id` như mọi bảng khác.
--
-- BAND 0582 (lane S16-SOCIAL-DB-2). Journal: idx 249, when 1717587371000 (> 0581 idx 248).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────── (0) CỔNG FAIL-CLOSED: migrator PHẢI vượt được RLS, nếu không thì DỪNG ỒN ÀO ───────
--   VÌ SAO CẦN: `companies` VÀ `feed_kudos_badges` đều ENABLE + FORCE RLS (đo 21/09/2026).
--   Nếu migrate chạy bằng vai KHÔNG có BYPASSRLS (vd `mediaos_owner`: rolsuper=f, rolbypassrls=f):
--     · `SELECT ... FROM companies` bị policy lọc còn **0 hàng** (không có `app.current_company_id`)
--     · ⇒ INSERT chèn **0 hàng**
--     · ⇒ VERIFY bên dưới tính `v_left = 0`, `v_co = 0` ⇒ `0 = 5 * 0` ⇒ **PASS**
--   Tức PROD không có huy hiệu nào mà migration vẫn báo XANH — đúng hình dạng
--   `empty-success-is-the-fail-open-shape`. Đẳng thức sở-hữu-lọc ở dưới KHÔNG tự bắt được ca này
--   (cả hai vế cùng bị lọc về 0), nên phải có cổng riêng ở đây.
--   Hôm nay CHẠY ĐƯỢC vì DATABASE_DIRECT_URL nối bằng `mediaos` (rolsuper=t, rolbypassrls=t) — cùng
--   vai mà CI dùng, và cùng khuôn `0538`/`0506` đã ship. Cổng này chốt điều đó lại thành hợp đồng.
DO $$
DECLARE
  v_can_bypass boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO v_can_bypass FROM pg_roles WHERE rolname = current_user;
  IF NOT COALESCE(v_can_bypass, false) THEN
    RAISE EXCEPTION '[0582] DUNG: vai migrate "%" khong co SUPERUSER/BYPASSRLS. companies va feed_kudos_badges deu RLS+FORCE => SELECT bi loc con 0, INSERT chen 0 hang, ma verify (0 = 5*0) van PASS = FAIL-OPEN IM LANG. Chay migrate bang vai co BYPASSRLS, hoac bo sung vong SET LOCAL app.current_company_id cho tung cong ty.', current_user;
  END IF;
END;
$$;
--> statement-breakpoint

INSERT INTO feed_kudos_badges (company_id, code, name, description, icon, is_active, position)
SELECT c.id, x.code, x.name, x.description, x.icon, true, x.position
  FROM companies c
 CROSS JOIN (VALUES
    ('teamwork',       'Tinh thần đồng đội',     'Ghi nhận tinh thần hợp tác, hỗ trợ đồng đội', 'users-round',     1::smallint),
    ('innovation',     'Sáng tạo',               'Ghi nhận ý tưởng hoặc cách làm mới hiệu quả', 'lightbulb',       2::smallint),
    ('customer-first', 'Tận tâm với khách hàng', 'Ghi nhận sự tận tâm phục vụ khách hàng',      'heart-handshake', 3::smallint),
    ('mentor',         'Người dẫn dắt',          'Ghi nhận việc kèm cặp, hướng dẫn đồng nghiệp','graduation-cap',  4::smallint),
    ('above-beyond',   'Vượt mong đợi',          'Ghi nhận nỗ lực vượt xa yêu cầu công việc',   'rocket',          5::smallint)
 ) AS x(code, name, description, icon, position)
 WHERE c.deleted_at IS NULL
ON CONFLICT (company_id, code) DO NOTHING;
--> statement-breakpoint

-- ─────────────── VERIFY (đẳng thức SỐ HỌC lọc theo phạm vi sở hữu — xem header) ───────────────
DO $$
DECLARE
  v_left int;
  v_co   int;
  v_bad  text;
BEGIN
  SELECT count(*) INTO v_left
    FROM feed_kudos_badges b
    JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
   WHERE b.code = ANY (ARRAY['teamwork', 'innovation', 'customer-first', 'mentor', 'above-beyond']);

  SELECT count(*) INTO v_co FROM companies WHERE deleted_at IS NULL;

  -- 0 company ⇒ 0 = 5 * 0 ⇒ PASS, no-op. Đây là đường chạy của MỌI lane DB/CI.
  IF v_left <> 5 * v_co THEN
    RAISE EXCEPTION '[0582] verify: % hang seed / ky vong % (5 x % cong ty con song)', v_left, 5 * v_co, v_co;
  END IF;

  -- Set-equality 5 mã per-company + is_active/position đúng — CHỈ khi có công ty (nếu không, mệnh đề
  -- này rỗng và "thành công RỖNG" chính là fail-open; neo thật ở int-spec §7 Nhóm 13).
  IF v_co > 0 THEN
    SELECT string_agg(z.d, '; ') INTO v_bad FROM (
      SELECT format('cong ty %s thieu %s', c.id, m.code) AS d
        FROM companies c
        CROSS JOIN (VALUES ('teamwork', 1), ('innovation', 2), ('customer-first', 3),
                           ('mentor', 4), ('above-beyond', 5)) AS m(code, pos)
       WHERE c.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM feed_kudos_badges b
                          WHERE b.company_id = c.id AND b.code = m.code
                            AND b.is_active AND b.position = m.pos)
    ) z;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '[0582] verify: seed huy hieu khong day du/sai is_active/position: %', v_bad;
    END IF;
  END IF;

  RAISE NOTICE '[0582] da seed 5 huy hieu x % cong ty (tong % hang trong pham vi so huu)', v_co, v_left;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- KHÔNG có down: catalog huy hiệu có thể đã được gắn vào `feed_kudos.badge_id` (composite FK
-- NO ACTION) và bị tenant sửa tên/icon. "Gỡ" = UPDATE is_active = false ở tầng ứng dụng.
