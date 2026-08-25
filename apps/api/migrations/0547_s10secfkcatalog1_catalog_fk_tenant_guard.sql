-- S10-SEC-FKCATALOG-1 · KI-055 — GUARD LỚP G: FK TRỎ TỚI CATALOG TOÀN CỤC PHẢI CÙNG TENANT HOẶC TOÀN CỤC
--
-- GỐC LỖI (phần CÒN LẠI của KI-046). `0535` vá 448/459 cặp FK một-cột tenant→tenant bằng composite FK
-- `(company_id, x) → parent(company_id, id)`. 11 cặp KHÔNG vá được vì bảng đích là **catalog TOÀN CỤC**
-- (`parent.company_id` NULLABLE, phần lớn hàng `company_id IS NULL`): composite FK đòi khớp đúng
-- `company_id` nên sẽ chặn luôn tham chiếu HỢP LỆ tới hàng toàn cục — đã chứng minh, gán role hệ thống nổ
-- `Key (company_id, role_id)=(A, <role hệ thống>) is not present in table "roles"`. ⇒ ĐỪNG THỬ LẠI HƯỚNG ĐÓ.
--
-- Hệ quả còn mở: kiểm tra FK của Postgres chạy với quyền hệ thống và **KHÔNG áp RLS** (hành vi thiết kế),
-- nên trong ngữ cảnh tenant A, `role_id → roles.id` vẫn trỏ được tới một hàng `roles` THUỘC TENANT B.
-- Tác hại đã ĐO (rls-tenant-isolation-tester, FULL gate 2026-07-31): A gán được role của B ⇒ B xoá role
-- của chính B (thao tác hợp lệ trong B) làm hàng `user_roles(company_id = A)` **biến mất theo CASCADE xuyên
-- tenant** — B tự ý gỡ quyền của A. Phòng thủ hiện tại chỉ nằm ở RLS tầng đọc + kiểm tra tầng service, tức
-- đúng chỗ BẤT BIẾN #1 (CLAUDE §2) nói phải ép ở tầng DB chứ không dựa vào kỷ luật dev.
--
-- SỐ ĐO TRƯỚC (13 câu §4.1/§4.2 của plan, chạy 2026-08-25 trên lane `mediaos_fkcatalog` head 0546 VÀ trên
-- PROD `mediaos`, chỉ SELECT):
--   • 459 FK một-cột giữa hai bảng tenant · 448 covered · **11 hở** (lớp T hở = 0 · lớp P = 24).
--   • Vi phạm tổ hợp #1 (con tenant → cha tenant KHÁC): **0** trên CẢ HAI DB, cả 11 cặp.
--   • Vi phạm tổ hợp #4 (con TOÀN CỤC → cha có chủ): **0** (`notification_templates` 47 hàng (NULL,NULL);
--     `seed_items` 71 hàng (tenant, cùng tenant)).
--   ⇒ Bước (0) tiền kiểm KHÔNG kích hoạt; migration này KHÔNG sửa/xoá hàng nào.
--   • Đo hành vi TRƯỚC vá (`catalog-fk-tenant-guard.int-spec.ts` trên lane chưa áp file này):
--     **11/11 cặp GHI THÀNH CÔNG** hàng lệch tenant dưới `mediaos_app` + GUC — lỗ có thật, khai thác được,
--     không phải rủi ro lý thuyết. Sau file này: 11/11 bị chặn 23503.
--
-- CƠ CHẾ ĐÃ CHỌN: **trigger `BEFORE INSERT OR UPDATE ... FOR EACH ROW`** trên 8 bảng CON, một hàm dùng
-- chung tham số hoá qua `TG_ARGV`. Hai hướng bị LOẠI, ghi ra để không ai thử lại:
--   (a) composite FK — đã chứng minh phá tham chiếu toàn cục (ở trên).
--   (b) `CHECK` + hàm đọc bảng khác — `CHECK` không được đánh giá lại khi bảng CHA đổi (nên vô dụng đúng
--       lúc cha bị "re-home"), và `pg_dump`/restore áp CHECK không theo thứ tự đảm bảo với dữ liệu. Cùng
--       lớp bài học "CHECK không ép được chuyển tiếp trạng thái".
-- Chi tiết + đánh đổi: `docs/DECISIONS/DECISIONS-10-*.md`.
--
-- NGỮ NGHĨA (4 tổ hợp; con = `NEW.company_id`, cha = `company_id` của hàng đích):
--   #1 con tenant · cha tenant KHÁC   → **DENY** 23503 `catalog_fk_tenant_mismatch`  ← lỗ đang vá
--   #2 con tenant · cha CÙNG tenant   → ALLOW
--   #3 con bất kỳ · cha TOÀN CỤC      → ALLOW  ← thứ composite FK đã phá; chặn nó = lặp lại thất bại
--   #4 con TOÀN CỤC · cha có chủ      → **DENY** (chỉ 2 cặp có `child.company_id` nullable) — rò theo
--      chiều NGƯỢC, phạm vi là MỌI tenant, nên nặng hơn #1.
--   Cột FK tự nó NULL ⇒ bỏ qua (mệnh đề `WHEN` cắt trước khi vào hàm).
--   Cha KHÔNG TỒN TẠI ⇒ `RETURN NEW`, để **FK một-cột cũ** raise 23503 chuẩn của nó. Đây là fail-open CÓ
--   KIỂM SOÁT và nó chỉ đúng chừng nào FK cũ còn sống ⇒ ĐỪNG DROP FK một-cột (ghim bằng ratchet (l)).
--
-- HÀNH VI MỚI:
--   • INSERT/UPDATE lệch tenant trên 8 bảng con từ nay **23503** `catalog_fk_tenant_mismatch`.
--   • `dashboard_widgets` từ nay BẤT BIẾN `company_id` (bước 1) — dư nợ của `0531`, vá kèm, KHÔNG cấp số
--     hiệu KI mới. Không có nó, một actor "cướp" widget toàn cục về tenant mình sẽ biến mọi
--     `dashboard_widget_cache/_configs` của tenant KHÁC đang trỏ tới widget đó thành hàng vi phạm SAU KHI
--     đã ghi — guard trên bảng con không bắn lại nên không bắt được.
--
-- ⚠️ LUẬT CHO MIGRATION SAU (đọc trước khi seed catalog NOTI — khuôn này đã lặp 5 lần: 0481, 0490, 0507,
--    0529, 0538): seed `notification_templates` toàn cục PHẢI kèm `AND e.company_id IS NULL` trong mệnh đề
--    JOIN sang `notification_events`. Nếu một hàng `notification_events` mang `company_id` của tenant trùng
--    `event_code`, `e.id` sẽ resolve về hàng đó ⇒ template `company_id NULL` trỏ cha có chủ = tổ hợp #4 =
--    DENY ⇒ **migration NOTI kế tiếp abort giữa deploy**. Hôm nay 61/61 event toàn cục nên chưa xảy ra.
--
-- CHI PHÍ CHẠY (nói cho đủ — KHÔNG "miễn phí"): mỗi INSERT/UPDATE trên 8 bảng con chạy thêm 1 lượt SELECT
-- PK-lookup trên bảng cha; 3 bảng có 2 cột FK cần kiểm (`dashboard_widget_cache`, `dashboard_widget_configs`,
-- `notifications`) ⇒ 2 lượt. Cộng chi phí `EXECUTE format()` (dynamic SQL, không hưởng plan cache). Mệnh đề
-- `WHEN (NEW.<col> IS NOT NULL)` cắt TRỌN chi phí cho nhánh FK NULL — quan trọng với 5 cặp `SET NULL` và với
-- `notifications` (fan-out 1 sự kiện → N người nhận).
--
-- GIỚI HẠN — **FORWARD-ONLY, KHÔNG HỒI TỐ**. Hàng lệch tạo TRƯỚC file này vẫn nguyên trong DB, và nếu cha bị
-- xoá thì CASCADE cũ vẫn xảy ra y hệt. Đo được 0 hàng lệch trên cả hai DB nên hôm nay vô hại — nhưng file
-- này KHÔNG dọn dữ liệu lịch sử, vì không có gì để dọn. Đường DUY NHẤT còn lại để hàng lệch quay vào DB là
-- **restore/`COPY`** (BEFORE ROW trigger CÓ bắn trong `COPY`, nhưng `pg_dump` phát trigger ở section
-- post-data nên restore không bị chặn oan) ⇒ sau mỗi lần restore phải chạy lại 13 câu đo, hoặc
-- `FK_DRIFT_ASSERT=1` + `xtenant-fk-ratchet.int-spec.ts`.
--
-- BẤT BIẾN GIỮ: KHÔNG `DELETE`/`UPDATE` dữ liệu (BẤT BIẾN #2 — `0533` từng dùng DELETE và đó là thứ `0535`
-- phải sửa lại); KHÔNG DROP FK một-cột cũ; KHÔNG đụng `apps/api/src/db/schema/**` (trigger là DB-object
-- thuần, Drizzle không model ⇒ KHÔNG chạy `db:generate`); idempotent (DROP IF EXISTS + CREATE OR REPLACE).
--
-- ĐƯỜNG LÙI (Down thủ công) ở CUỐI FILE — liệt kê ĐÍCH DANH từng trigger, KHÔNG dùng `LIKE` quét rộng
-- (bài học R10 của `0535`: bản lọc `LIKE '%_company_fk'` gỡ nhầm constraint của `0503`).

-- ── KHOÁ ────────────────────────────────────────────────────────────────────────────────────────────
-- File này lấy ACCESS EXCLUSIVE trên 9 bảng (`dashboard_widgets` + 8 bảng con, trong đó có `notifications`
-- và `user_roles` — ghi liên tục) và GIỮ tới lúc commit, vì drizzle bọc TOÀN BỘ lượt migrate trong MỘT
-- transaction. Không có `lock_timeout`, một transaction dài đang giữ khoá trên bảng nóng sẽ làm
-- `CREATE TRIGGER` xếp hàng, và MỌI câu tới sau xếp hàng phía sau nó ⇒ đóng băng hàng đợi khoá của cả DB
-- giữa lúc deploy. Fail-fast thay vì treo: `0535` đã đặt đúng khuôn này (do security-reviewer FULL gate
-- 2026-07-31 yêu cầu) và `0546` theo; `0547` bỏ sót — vá ở đây (FULL gate 2026-08-25).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

-- ── (0) TIỀN KIỂM — 13 câu đo, RAISE EXCEPTION nếu có hàng lệch. KHÔNG tự dọn. ────────────────────────
DO $precheck$
DECLARE
  r record;
  n bigint;
  v_bad text[] := ARRAY[]::text[];
BEGIN
  -- Tổ hợp #1 — 11 cặp lớp G.
  FOR r IN
    SELECT * FROM (VALUES
      ('user_roles',               'role_id',            'roles'),
      ('positions',                'default_role_id',    'roles'),
      ('dashboard_widget_cache',   'role_id',            'roles'),
      ('dashboard_widget_configs', 'role_id',            'roles'),
      ('dashboard_widget_cache',   'widget_id',          'dashboard_widgets'),
      ('dashboard_widget_configs', 'widget_id',          'dashboard_widgets'),
      ('notification_templates',   'event_id',           'notification_events'),
      ('notifications',            'event_id',           'notification_events'),
      ('notifications',            'template_id',        'notification_templates'),
      ('leave_request_days',       'public_holiday_id',  'public_holidays'),
      ('seed_items',               'seed_batch_id',      'seed_batches')
    ) AS t(src, col, tgt)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c JOIN public.%I p ON p.id = c.%I
        WHERE c.%I IS NOT NULL AND c.company_id IS NOT NULL
          AND p.company_id IS NOT NULL AND c.company_id <> p.company_id',
      r.src, r.tgt, r.col, r.col
    ) INTO n;
    IF n > 0 THEN
      v_bad := v_bad || format('%s.%s -> %s (tổ hợp #1): %s hàng', r.src, r.col, r.tgt, n);
    END IF;
  END LOOP;

  -- Tổ hợp #4 — 2 cặp có `child.company_id` NULLABLE.
  FOR r IN
    SELECT * FROM (VALUES
      ('notification_templates', 'event_id',      'notification_events'),
      ('seed_items',             'seed_batch_id', 'seed_batches')
    ) AS t(src, col, tgt)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c JOIN public.%I p ON p.id = c.%I
        WHERE c.%I IS NOT NULL AND c.company_id IS NULL AND p.company_id IS NOT NULL',
      r.src, r.tgt, r.col, r.col
    ) INTO n;
    IF n > 0 THEN
      v_bad := v_bad || format('%s.%s -> %s (tổ hợp #4): %s hàng', r.src, r.col, r.tgt, n);
    END IF;
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION E'[0547] CÓ HÀNG LỆCH TENANT ở lớp G — DỪNG, KHÔNG tự dọn (BẤT BIẾN #2):\n%\n'
      'Guard chỉ chặn ghi MỚI, không hồi tố. Người phải quyết xoá hay sửa từng hàng, rồi chạy lại '
      '(file này idempotent).', array_to_string(v_bad, E'\n');
  END IF;

  RAISE NOTICE '[0547] (0) tiền kiểm: 13 câu đo = 0 hàng lệch — không kích hoạt nhánh dừng';
END $precheck$;
--> statement-breakpoint

-- ── (1) DƯ NỢ CỦA `0531`: `dashboard_widgets` chưa có trigger bất biến `company_id` ──────────────────
-- Đo trên `pg_trigger` (lane + PROD): đúng 8 bảng có `enforce_company_id_immutable`
-- (`data_retention_policies · notification_events · notification_templates · public_holidays · roles ·
-- seed_batches · seed_items · sequence_counters`) — `dashboard_widgets` VẮNG MẶT, trong khi 17/17 hàng
-- của nó là hàng toàn cục. Tái dùng ĐÚNG hàm của `0436`, KHÔNG viết hàm mới; khuôn giống hệt `0531`.
DROP TRIGGER IF EXISTS trg_dashboard_widgets_company_immutable ON dashboard_widgets;
--> statement-breakpoint

CREATE TRIGGER trg_dashboard_widgets_company_immutable
  BEFORE UPDATE ON dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();
--> statement-breakpoint

-- ── (2) HÀM GUARD DÙNG CHUNG ─────────────────────────────────────────────────────────────────────────
-- `SECURITY DEFINER` là BẮT BUỘC, không phải tiện tay: `mediaos_app` chịu FORCE RLS đầy đủ (đo được cả 8
-- bảng `relrowsecurity = on` AND `relforcerowsecurity = on`). Nếu hàm chạy bằng quyền invoker, câu
-- `SELECT company_id FROM roles WHERE id = $1` trong ngữ cảnh tenant A sẽ bị policy
-- `USING (company_id = GUC OR company_id IS NULL)` **che hàng của tenant B** ⇒ trả 0 hàng ⇒ rơi vào nhánh
-- "cha không tồn tại" ⇒ `RETURN NEW` ⇒ **guard cho qua đúng cái nó phải chặn**. Đó là lỗ đang vá tái xuất
-- hiện ngay trong lớp guard mới. Chủ hàm = role chạy migration (`mediaos`, superuser + BYPASSRLS — đã đo
-- `proowner` của `enforce_company_id_immutable`/`refresh_dashboard_mvs`), nên `SECURITY DEFINER` thật sự
-- bỏ qua RLS. **Nếu mất tính chất đó (vd `pg_restore --no-owner`, migration chạy bằng `mediaos_owner`)
-- guard fail-open IM LẶNG** ⇒ điều kiện (4) của khối tự-kiểm và ratchet (m) canh đúng chỗ này.
--
-- `search_path = pg_catalog, pg_temp` (hẹp hơn `public, pg_temp` của `0534`) vì thân hàm schema-qualify
-- `public.%I` tường minh. HỆ QUẢ khi sửa về sau: dưới search_path này mọi tham chiếu quan hệ KHÔNG qualify
-- sẽ lỗi `relation … does not exist` (đã đo: `DECLARE r roles%ROWTYPE` gãy lúc biên dịch hàm) — đừng thêm
-- khai báo kiểu đó. `pg_temp` đặt CUỐI theo khuyến nghị của PG cho `SECURITY DEFINER` (chặn bảng tạm che tên).
CREATE OR REPLACE FUNCTION enforce_company_id_catalog_fk() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_parent_table   text := TG_ARGV[0];
  v_fk_col         text := TG_ARGV[1];
  v_fk_value       uuid;
  v_parent_company uuid;
  v_found          boolean;   -- cờ SENTINEL — KHÔNG thay bằng `FOUND`, xem khối chú thích dưới
  v_row            jsonb;
BEGIN
  -- `to_jsonb(NEW)` serialize TOÀN BỘ hàng (kể cả cột payload jsonb của `dashboard_widget_cache` /
  -- `notifications`) ⇒ dựng ĐÚNG MỘT LẦN rồi dùng lại cho cả `?` lẫn `->>`. Gọi hai lần thì
  -- `notifications` (2 trigger guard: `event_id` + `template_id`) tốn 4 lượt serialize toàn-hàng cho
  -- mỗi notification, nhân với fan-out N người nhận.
  v_row := to_jsonb(NEW);

  -- `->>` với khoá KHÔNG tồn tại trả NULL chứ không lỗi ⇒ một ký tự gõ nhầm trong `TG_ARGV[1]` của một
  -- trong 11 `CREATE TRIGGER` sẽ làm bảng đó KHÔNG được bảo vệ mà không có gì kêu. Chặn tại gốc:
  IF NOT (v_row ? v_fk_col) THEN
    RAISE EXCEPTION 'catalog_fk_guard: cột % không tồn tại trên %', v_fk_col, TG_TABLE_NAME
      USING ERRCODE = 'internal_error';
  END IF;

  v_fk_value := (v_row ->> v_fk_col)::uuid;
  IF v_fk_value IS NULL THEN
    RETURN NEW;   -- cột FK tự nó NULL: không phải việc của guard này (mệnh đề WHEN đã cắt phần lớn)
  END IF;

  -- ⛔ `EXECUTE` KHÔNG ĐẶT `FOUND` — đã ĐO 2026-08-25, không phải phòng xa. PL/pgSQL chỉ cho `EXECUTE`
  -- cập nhật `GET DIAGNOSTICS`, KHÔNG cập nhật `FOUND`; giá trị đọc được chỉ là tàn dư của câu TRƯỚC đó.
  -- Bản nháp viết `IF NOT FOUND THEN RETURN NEW` ⇒ vì không câu nào đặt `FOUND` trước đó, điều kiện LUÔN
  -- đúng ⇒ **guard `RETURN NEW` vô điều kiện, không bao giờ chặn gì** — mà migration vẫn xanh và trigger
  -- vẫn "tồn tại". Hằng `true` làm sentinel phân biệt được CẢ BA ca trong ĐÚNG MỘT câu lệnh:
  --   cha toàn cục có thật → v_found = true , v_parent_company IS NULL
  --   cha của tenant       → v_found = true , v_parent_company = <uuid>
  --   cha không tồn tại    → v_found IS NULL
  EXECUTE format('SELECT true, company_id FROM public.%I WHERE id = $1', v_parent_table)
    INTO v_found, v_parent_company USING v_fk_value;

  IF v_found IS NULL THEN
    RETURN NEW;   -- 0 hàng: để FK một-cột CŨ raise 23503 chuẩn của nó (một nguồn lỗi cho "mồ côi khoá ngoại")
  END IF;

  IF v_parent_company IS NULL THEN
    RETURN NEW;   -- tổ hợp #3: cha là hàng catalog TOÀN CỤC — ALLOW
  END IF;

  IF NEW.company_id IS NULL OR NEW.company_id <> v_parent_company THEN
    RAISE EXCEPTION
      'catalog_fk_tenant_mismatch: %.% trỏ tới hàng của % thuộc tenant khác (hoặc hàng con toàn cục trỏ tới hàng có chủ)',
      TG_TABLE_NAME, v_fk_col, v_parent_table
      USING ERRCODE = 'foreign_key_violation';   -- 23503, đồng bộ với composite FK của `0535` (ca W4)
  END IF;

  RETURN NEW;     -- tổ hợp #2: cùng tenant — ALLOW
END;
$fn$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION enforce_company_id_catalog_fk() FROM PUBLIC;
--> statement-breakpoint

-- KHÔNG `GRANT EXECUTE TO mediaos_app`: đã ĐO (lane, 2026-08-25) rằng trigger vẫn bắn bình thường dưới
-- `mediaos_app` khi hàm chỉ bị REVOKE khỏi PUBLIC và không được grant cho ai — PG kiểm quyền EXECUTE của
-- hàm trigger lúc **TẠO** trigger (bởi role chạy migration), không lúc bắn. Bỏ GRANT = hẹp hơn, đúng hướng
-- least-privilege của `0540`.
COMMENT ON FUNCTION enforce_company_id_catalog_fk() IS
  'S10-SEC-FKCATALOG-1 (KI-055): guard lớp G — hàng con chỉ trỏ được tới hàng cha CÙNG TENANT hoặc hàng TOÀN CỤC (company_id IS NULL). SECURITY DEFINER vì mediaos_app chịu FORCE RLS ⇒ invoker sẽ bị RLS che hàng cha của tenant khác và guard hoá mù. Xem DECISIONS-10.';
--> statement-breakpoint

-- ── (3) 11 TRIGGER ───────────────────────────────────────────────────────────────────────────────────
-- `WHEN (NEW.<col> IS NOT NULL)` là bộ LỌC hiệu năng, KHÔNG thay được kiểm tra trong hàm — hàm vẫn giữ
-- nhánh `IF v_fk_value IS NULL THEN RETURN NEW` phòng khi trigger bị tạo lại thiếu `WHEN`.

DROP TRIGGER IF EXISTS trg_user_roles_role_id_catalog_fk ON user_roles;
--> statement-breakpoint
CREATE TRIGGER trg_user_roles_role_id_catalog_fk
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW WHEN (NEW.role_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('roles', 'role_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_positions_default_role_id_catalog_fk ON positions;
--> statement-breakpoint
CREATE TRIGGER trg_positions_default_role_id_catalog_fk
  BEFORE INSERT OR UPDATE ON positions
  FOR EACH ROW WHEN (NEW.default_role_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('roles', 'default_role_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_dashboard_widget_cache_role_id_catalog_fk ON dashboard_widget_cache;
--> statement-breakpoint
CREATE TRIGGER trg_dashboard_widget_cache_role_id_catalog_fk
  BEFORE INSERT OR UPDATE ON dashboard_widget_cache
  FOR EACH ROW WHEN (NEW.role_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('roles', 'role_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_dashboard_widget_configs_role_id_catalog_fk ON dashboard_widget_configs;
--> statement-breakpoint
CREATE TRIGGER trg_dashboard_widget_configs_role_id_catalog_fk
  BEFORE INSERT OR UPDATE ON dashboard_widget_configs
  FOR EACH ROW WHEN (NEW.role_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('roles', 'role_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_dashboard_widget_cache_widget_id_catalog_fk ON dashboard_widget_cache;
--> statement-breakpoint
CREATE TRIGGER trg_dashboard_widget_cache_widget_id_catalog_fk
  BEFORE INSERT OR UPDATE ON dashboard_widget_cache
  FOR EACH ROW WHEN (NEW.widget_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('dashboard_widgets', 'widget_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_dashboard_widget_configs_widget_id_catalog_fk ON dashboard_widget_configs;
--> statement-breakpoint
CREATE TRIGGER trg_dashboard_widget_configs_widget_id_catalog_fk
  BEFORE INSERT OR UPDATE ON dashboard_widget_configs
  FOR EACH ROW WHEN (NEW.widget_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('dashboard_widgets', 'widget_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_notification_templates_event_id_catalog_fk ON notification_templates;
--> statement-breakpoint
CREATE TRIGGER trg_notification_templates_event_id_catalog_fk
  BEFORE INSERT OR UPDATE ON notification_templates
  FOR EACH ROW WHEN (NEW.event_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('notification_events', 'event_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_notifications_event_id_catalog_fk ON notifications;
--> statement-breakpoint
CREATE TRIGGER trg_notifications_event_id_catalog_fk
  BEFORE INSERT OR UPDATE ON notifications
  FOR EACH ROW WHEN (NEW.event_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('notification_events', 'event_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_notifications_template_id_catalog_fk ON notifications;
--> statement-breakpoint
CREATE TRIGGER trg_notifications_template_id_catalog_fk
  BEFORE INSERT OR UPDATE ON notifications
  FOR EACH ROW WHEN (NEW.template_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('notification_templates', 'template_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_leave_request_days_public_holiday_id_catalog_fk ON leave_request_days;
--> statement-breakpoint
CREATE TRIGGER trg_leave_request_days_public_holiday_id_catalog_fk
  BEFORE INSERT OR UPDATE ON leave_request_days
  FOR EACH ROW WHEN (NEW.public_holiday_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('public_holidays', 'public_holiday_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_seed_items_seed_batch_id_catalog_fk ON seed_items;
--> statement-breakpoint
CREATE TRIGGER trg_seed_items_seed_batch_id_catalog_fk
  BEFORE INSERT OR UPDATE ON seed_items
  FOR EACH ROW WHEN (NEW.seed_batch_id IS NOT NULL)
  EXECUTE FUNCTION enforce_company_id_catalog_fk('seed_batches', 'seed_batch_id');
--> statement-breakpoint

-- TRẢ `lock_timeout` VỀ MẶC ĐỊNH. `SET LOCAL` sống tới hết TRANSACTION, mà drizzle bọc TẤT CẢ migration
-- đang chờ trong MỘT transaction ⇒ không trả lại thì mọi migration áp SAU `0547` trong cùng lượt chạy
-- cũng thừa hưởng timeout 5s và có thể chết oan vì một khoá chậm không liên quan (bước (3) của `0535`).
SET LOCAL lock_timeout = DEFAULT;
--> statement-breakpoint

-- ── (4) TỰ-KIỂM — "migration chạy xong" KHÔNG chứng minh "guard sống" ────────────────────────────────
-- Đặt CUỐI file: điều kiện nào sai thì migration abort và transaction cuốn lại toàn bộ (drizzle bọc cả
-- lượt migrate trong MỘT transaction) — không để lại trạng thái nửa vời.
DO $selfcheck$
DECLARE
  v_triggers int;
  v_secdef   boolean;
  v_config   text[];
  v_owner_ok boolean;
  v_acl      aclitem[];
  v_public   boolean;
BEGIN
  -- (1) đủ 11 trigger guard + trigger bất biến của `dashboard_widgets`.
  SELECT count(*) INTO v_triggers
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE p.proname = 'enforce_company_id_catalog_fk'
     AND p.pronamespace = 'public'::regnamespace   -- đồng bộ với các câu (2)-(5) dưới; đừng đếm hàm trùng tên ở schema khác
     AND NOT t.tgisinternal;
  IF v_triggers <> 11 THEN
    RAISE EXCEPTION '[0547] tự-kiểm (1): có % trigger guard, cần đúng 11', v_triggers;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_dashboard_widgets_company_immutable'
       AND tgrelid = 'public.dashboard_widgets'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '[0547] tự-kiểm (1): thiếu trg_dashboard_widgets_company_immutable';
  END IF;

  SELECT p.prosecdef, p.proconfig, (r.rolsuper OR r.rolbypassrls), p.proacl
    INTO v_secdef, v_config, v_owner_ok, v_acl
    FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.proname = 'enforce_company_id_catalog_fk'
     AND p.pronamespace = 'public'::regnamespace;

  -- (2) SECURITY DEFINER.
  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION '[0547] tự-kiểm (2): enforce_company_id_catalog_fk KHÔNG phải SECURITY DEFINER';
  END IF;

  -- (3) search_path bị khoá.
  IF v_config IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(v_config) c WHERE c LIKE 'search_path=%'
  ) THEN
    RAISE EXCEPTION '[0547] tự-kiểm (3): hàm KHÔNG khoá search_path (bắt buộc với SECURITY DEFINER)';
  END IF;

  -- (4) ĐIỀU KIỆN SỐNG-CÒN: chủ hàm phải BYPASSRLS. FORCE RLS áp cả lên CHỦ BẢNG, nên chủ hàm không
  --     BYPASSRLS sẽ bị policy che hàng cha của tenant khác ⇒ guard rơi vào nhánh "cha không tồn tại"
  --     ⇒ FAIL-OPEN IM LẶNG, trong khi trigger vẫn tồn tại và mọi lưới khác vẫn xanh.
  IF NOT COALESCE(v_owner_ok, false) THEN
    RAISE EXCEPTION '[0547] tự-kiểm (4): chủ hàm KHÔNG có rolsuper/rolbypassrls ⇒ SECURITY DEFINER vẫn bị RLS che ⇒ guard fail-open im lặng';
  END IF;

  -- (5) PUBLIC không còn EXECUTE. `proacl` NULL = ACL mặc định ⇒ PUBLIC VẪN có EXECUTE (REVOKE trượt).
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '[0547] tự-kiểm (5): proacl NULL (mặc định) — REVOKE ALL FROM PUBLIC không áp';
  END IF;
  SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE') INTO v_public FROM aclexplode(v_acl) a;
  IF COALESCE(v_public, false) THEN
    RAISE EXCEPTION '[0547] tự-kiểm (5): PUBLIC vẫn có EXECUTE trên enforce_company_id_catalog_fk';
  END IF;

  RAISE NOTICE '[0547] tự-kiểm OK — 11 trigger guard · SECURITY DEFINER · search_path khoá · chủ hàm BYPASSRLS · PUBLIC không EXECUTE';
END $selfcheck$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- Liệt kê ĐÍCH DANH (bài học R10 của 0535: bộ lọc LIKE gỡ nhầm constraint của migration khác).
-- DROP TRIGGER IF EXISTS trg_user_roles_role_id_catalog_fk ON user_roles;
-- DROP TRIGGER IF EXISTS trg_positions_default_role_id_catalog_fk ON positions;
-- DROP TRIGGER IF EXISTS trg_dashboard_widget_cache_role_id_catalog_fk ON dashboard_widget_cache;
-- DROP TRIGGER IF EXISTS trg_dashboard_widget_configs_role_id_catalog_fk ON dashboard_widget_configs;
-- DROP TRIGGER IF EXISTS trg_dashboard_widget_cache_widget_id_catalog_fk ON dashboard_widget_cache;
-- DROP TRIGGER IF EXISTS trg_dashboard_widget_configs_widget_id_catalog_fk ON dashboard_widget_configs;
-- DROP TRIGGER IF EXISTS trg_notification_templates_event_id_catalog_fk ON notification_templates;
-- DROP TRIGGER IF EXISTS trg_notifications_event_id_catalog_fk ON notifications;
-- DROP TRIGGER IF EXISTS trg_notifications_template_id_catalog_fk ON notifications;
-- DROP TRIGGER IF EXISTS trg_leave_request_days_public_holiday_id_catalog_fk ON leave_request_days;
-- DROP TRIGGER IF EXISTS trg_seed_items_seed_batch_id_catalog_fk ON seed_items;
-- REVOKE ALL ON FUNCTION enforce_company_id_catalog_fk() FROM PUBLIC;
-- DROP FUNCTION IF EXISTS enforce_company_id_catalog_fk();
-- DROP TRIGGER IF EXISTS trg_dashboard_widgets_company_immutable ON dashboard_widgets;
