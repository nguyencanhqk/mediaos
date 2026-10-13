-- Migration 0592: S16-SOCIAL-DASH-1 — 2 widget DASH của SOCIAL (SPEC-16 §17.3: SOCIAL-WIDGET-001 ·
-- SOCIAL-WIDGET-002, theo SPEC-01 §9.9).
--
-- MỤC TIÊU: nới CHECK module của catalog thêm 'SOCIAL' rồi thêm 2 hàng GLOBAL vào `dashboard_widgets`
-- — khuôn mig 0568 (ALTER CHECK + hàng catalog) và 0576 (2 hàng + khối verify). THUẦN ADDITIVE: không
-- tạo bảng, không đụng hàng/cột/constraint nào khác; RLS + FORCE và grant SELECT-only của bảng giữ
-- nguyên từ 0482 (hàng `company_id NULL` đọc được ở mọi công ty qua nhánh `OR company_id IS NULL` của
-- policy — đúng nghĩa catalog dùng chung).
--   • SOCIAL_ENGAGEMENT_WEEK — «Tương tác tuần»: số bài · bình luận · cảm xúc · thành viên hoạt động
--     của TUẦN HIỆN TẠI. Nguồn `SocialStatsService.weeklyEngagementForWidget(user)` = ĐÚNG câu thống kê
--     của route 052 (SOCIAL-API-052) — một công thức, KHÔNG cộng lại ở tầng widget.
--   • SOCIAL_NEWS_UNACKED — «Tin tức chưa đọc»: ĐẾM tin yêu cầu xác nhận mà CHÍNH người gọi chưa xác
--     nhận. Nguồn `SocialNewsService.list(user, { limit: 1, countOnly: true })` = nhánh `countOnly` của
--     route 020 (SOCIAL-API-020). Chỉ một con số: KHÔNG tên người, KHÔNG nội dung bài.
--
-- HOT-FILE APPEND (CLAUDE.md §9.3): `chk_dashboard_widgets_module_code` là CHECK UNION — catalog CHƯA
-- có 'SOCIAL' (0482 liệt 8 module gốc; 0525 append 'GOAL'; 0558 'ASSET','ROOM'; 0563 'RECRUIT'; 0568
-- 'PAYROLL'). ALTER = DROP + ADD với superset VIẾT TAY: giữ nguyên 13 giá trị cũ + THÊM 1.
-- 🔴 Superset viết tay sẽ ÂM THẦM XOÁ giá trị mà một nhánh khác vừa thêm vào CHECK (bẫy
--    `audit-check-union-parse-anchor-trap`) ⇒ bước (2) CHỐT TIỀN ĐỀ trước khi DROP: tập literal của
--    CHECK hiện tại phải ĐÚNG BẰNG 13 giá trị đã biết (lần áp đầu) hoặc 13 + 'SOCIAL' (chạy lại file);
--    khác đi, hoặc đọc không ra ⇒ NÉM, không đoán.
-- ⚠️ Hệ quả CÓ CHỦ ĐÍCH: chạy lại file này SAU khi một module khác đã nới CHECK thêm ⇒ đỏ
--    `[0592] precheck` — đúng, vì bước (3) sẽ xoá giá trị của module đó. Migration nới CHECK kế tiếp
--    phải tự liệt kê đủ superset của nó (13 giá trị cũ + 'SOCIAL' + giá trị mới), không «chạy lại 0592».
--
-- KHÔNG seed permission/role_permissions: widget gate bằng cặp NGUỒN, Option B
-- (`DASH_WIDGET_GATE_PAIR`) — cả hai cặp ĐÃ seed + grant ở mig 0578, đều is_sensitive=false:
--   • SOCIAL_ENGAGEMENT_WEEK → ('view','feed-report') = cặp của route nguồn 052; grant manager
--                              @Department · hr + company-admin @Company (0578:108-110).
--   • SOCIAL_NEWS_UNACKED    → ('view','feed') = cặp của route nguồn 020; grant employee · manager ·
--                              hr · company-admin @Company (0578:63-66).
--
-- CỔNG PHỤ (KHÔNG ở migration): SÀN scope của GRANT, ép ở HAI tầng ứng dụng đọc CÙNG một hằng
-- (`DASH_WIDGET_MIN_DATA_SCOPE`: đường METADATA /dashboard/me và đường DATA của handler). KHÔNG ép
-- được bằng CHECK/RLS vì scope là thuộc tính của GRANT, không phải của hàng catalog.
--   • SOCIAL_ENGAGEMENT_WEEK: sàn `Department` — `default_data_scope` = 'Department' TRÙNG sàn. Grant
--     `Own`/`Team` nhận số 0 từ nguồn (không 403) nên DASH phải tự ẩn widget ở hai scope đó.
--   • SOCIAL_NEWS_UNACKED: sàn `Company` (route 020 chỉ nhận grant @Company). `default_data_scope` =
--     'Own' ở đây là NHÃN DỮ LIỆU («đếm cho chính người gọi»), KHÔNG phải sàn — đừng đọc cột này như
--     cận dưới của grant.
--
-- KHÔNG ghi `is_cacheable` (mặc định true như cả 23 hàng sẵn có; tại 12/10/2026 không mã runtime nào
-- đọc cột này): «không cache số thống kê» (SOC-DEC-010) ép ở tầng ứng dụng bằng TTL 0 của module SOCIAL.
--
-- `dashboard_widget_configs` KHÔNG seed ở migration (company_id NOT NULL, công ty chỉ tồn tại SAU boot)
-- — seed RUNTIME qua `DashboardConfigSeeder` đọc `DASH_DEFAULT_CONFIG` (bump seedVersion v6→v7).
-- ⚠️ THỨ TỰ DEPLOY: migrate TRƯỚC khi boot bản API mới — seeder ném khi thiếu hàng catalog và chỉ để
--    lại log.
--
-- KHÔNG đụng `apps/api/src/db/schema/dashboard.ts` (drift CỐ Ý từ 0525 — migration là nguồn DDL thật).
--
-- Journal: idx 259, when 1717587381000 (> head 0591 idx 258).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (1) lock_timeout — khuôn 0587:35-48 ───────────
-- Bước (2)–(3) cần ACCESS EXCLUSIVE trên `dashboard_widgets` (bảng mà mọi `GET /dashboard/me` đọc).
-- Khoá giữ tới COMMIT của CẢ lượt migrate (drizzle gộp mọi migration pending vào MỘT transaction): chỉ
-- vài ms khi 0592 là migration pending CUỐI CÙNG của lượt — có migration khác chạy sau trong cùng lượt
-- thì Dashboard đứng suốt các migration đó (xem ghi chú deploy ở thân PR). Thời gian CHỜ lấy khoá thì
-- không bị chặn bởi kích
-- thước bảng: một transaction dài đang đọc bảng làm migration đợi VÔ HẠN, và vì khoá xếp hàng, mọi
-- lượt đọc catalog đến sau cũng kẹt theo suốt lượt deploy. Thà đỏ rồi chạy lại.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

-- ─────────── (2) CHỐT TIỀN ĐỀ — CHECK hiện tại phải là tập ĐÃ BIẾT (fail-closed) ───────────
-- Lấy khoá TRƯỚC khi đọc: cùng mức ACCESS EXCLUSIVE mà bước (3) đằng nào cũng lấy, nhờ vậy định nghĩa
-- mà chốt này đọc chính là định nghĩa bước (3) sẽ DROP (không phiên nào chen được một ALTER vào giữa).
-- Tách MỌI literal trong nháy đơn của `pg_get_constraintdef` (dạng đo được trên PG 17:
-- `= ANY ((ARRAY['AUTH'::character varying, …])::text[])` — phần tử CÓ nháy), xếp theo byte rồi so
-- NGUYÊN MẢNG. Cố ý bắt mọi literal chứ không chỉ chuỗi chữ hoa: một giá trị kiểu 'Chat2' mà lọt khỏi
-- phép tách thì chốt này xanh trong khi bước (3) xoá nó. Không thấy constraint, hoặc văn bản ở dạng
-- khác (vd '{A,B}'::text[]) ⇒ mảng NULL / lệch ⇒ NÉM.
DO $$
DECLARE
  -- 13 giá trị ngay TRƯỚC file này, xếp theo byte (COLLATE "C"): 8 gốc (0482) + GOAL (0525) +
  -- ASSET · ROOM (0558) + RECRUIT (0563) + PAYROLL (0568).
  v_known CONSTANT text[] := ARRAY['ASSET','ATT','AUTH','DASH','GOAL','HR','LEAVE','NOTI',
                                   'PAYROLL','RECRUIT','ROOM','SYSTEM','TASK'];
  -- Trạng thái SAU file này (lần chạy lại): 13 giá trị trên + 'SOCIAL'.
  v_after CONSTANT text[] := ARRAY['ASSET','ATT','AUTH','DASH','GOAL','HR','LEAVE','NOTI',
                                   'PAYROLL','RECRUIT','ROOM','SOCIAL','SYSTEM','TASK'];
  v_cur text[];
BEGIN
  LOCK TABLE dashboard_widgets IN ACCESS EXCLUSIVE MODE;

  SELECT array_agg(m[1] ORDER BY m[1] COLLATE "C") INTO v_cur
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') AS m
   WHERE c.conrelid = 'dashboard_widgets'::regclass
     AND c.conname = 'chk_dashboard_widgets_module_code';

  IF v_cur IS DISTINCT FROM v_known AND v_cur IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION '[0592] precheck: CHECK chk_dashboard_widgets_module_code dang chua {%} - khong phai 13 gia tri da biet (cung khong phai 13 + SOCIAL cua lan chay lai). Buoc (3) la superset VIET TAY nen chay tiep se XOA gia tri la. Them gia tri do vao v_known, v_after, buoc (3) va buoc (5) roi chay lai.',
      coalesce(array_to_string(v_cur, ','), 'KHONG DOC DUOC');
  END IF;
END $$;
--> statement-breakpoint

-- ─────────── (3) CHECK union APPEND — thêm 'SOCIAL' vào chk_dashboard_widgets_module_code ───────────
-- 13 giá trị cũ ĐÚNG thứ tự của 0568:48 + 'SOCIAL' ở cuối.
ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
  CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','ASSET','ROOM','RECRUIT','PAYROLL','SOCIAL'));
--> statement-breakpoint

-- ─────────── (4) Catalog widget GLOBAL (company_id NULL) ───────────
-- ON CONFLICT arbiter = partial unique uq_dashboard_widgets_global_code_active (0482):
--   ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL → predicate lặp lại ở WHERE.
-- `is_system_widget` ghi true TƯỜNG MINH (mặc định của cột là false). widget_type = 'Summary' (mấy con
-- số đếm) — khớp CHECK chk_dashboard_widgets_type (0482:73-74). sort_order nối tiếp 120 của mig 0576.
INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES
  (NULL, 'SOCIAL_ENGAGEMENT_WEEK', 'SOCIAL', 'Tương tác tuần', 'Summary',
   'DASH.WIDGET.VIEW_SOCIAL_ENGAGEMENT_WEEK', 'Department', 'social-engagement-week',
   'SocialEngagementWeekWidget',
   true, 'Active', 130),
  (NULL, 'SOCIAL_NEWS_UNACKED', 'SOCIAL', 'Tin tức chưa đọc', 'Summary',
   'DASH.WIDGET.VIEW_SOCIAL_NEWS_UNACKED', 'Own', 'social-news-unacked',
   'SocialNewsUnackedWidget',
   true, 'Active', 140)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────── (5) VERIFY — fail LOUD ───────────
-- (a)+(b) Catalog có ĐÚNG 2 hàng SOCIAL toàn cục còn sống và CẢ HAI khớp từng trường mà
--         `dash-seed-catalog-permissions.int-spec.ts` so với hằng (module · type · permission code ·
--         scope · slug · component · is_system_widget · status). `ON CONFLICT DO NOTHING` giữ nguyên
--         một hàng cũ lệch trường ⇒ phải đỏ Ở ĐÂY, không đợi tới lúc seeder / test phát hiện.
-- (c)     CHECK sau khi nới có ĐỦ 14 giá trị (cùng phép tách của bước (2)).
DO $$
DECLARE
  v_all   integer;
  v_match integer;
  v_cur   text[];
BEGIN
  SELECT count(*) INTO v_all
    FROM dashboard_widgets w
   WHERE w.company_id IS NULL AND w.deleted_at IS NULL AND w.module_code = 'SOCIAL';

  SELECT count(*) INTO v_match
    FROM dashboard_widgets w
    JOIN (VALUES
      ('SOCIAL_ENGAGEMENT_WEEK', 'DASH.WIDGET.VIEW_SOCIAL_ENGAGEMENT_WEEK', 'Department',
       'social-engagement-week', 'SocialEngagementWeekWidget'),
      ('SOCIAL_NEWS_UNACKED', 'DASH.WIDGET.VIEW_SOCIAL_NEWS_UNACKED', 'Own',
       'social-news-unacked', 'SocialNewsUnackedWidget')
    ) AS e(widget_code, permission_code, data_scope, slug, component)
      ON e.widget_code = w.widget_code
   WHERE w.company_id IS NULL AND w.deleted_at IS NULL
     AND w.module_code = 'SOCIAL'
     AND w.widget_type = 'Summary'
     AND w.required_permission_code = e.permission_code
     AND w.default_data_scope = e.data_scope
     AND w.data_source_key = e.slug
     AND w.component_key = e.component
     AND w.is_system_widget
     AND w.status = 'Active';

  IF v_all <> 2 OR v_match <> 2 THEN
    RAISE EXCEPTION '[0592] verify: catalog co % hang SOCIAL toan cuc con song (ky vong 2), trong do % hang khop du 8 truong (ky vong 2) - ON CONFLICT DO NOTHING da giu mot hang cu LECH truong, hoac co hang SOCIAL la',
      v_all, v_match;
  END IF;

  SELECT array_agg(m[1] ORDER BY m[1] COLLATE "C") INTO v_cur
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') AS m
   WHERE c.conrelid = 'dashboard_widgets'::regclass
     AND c.conname = 'chk_dashboard_widgets_module_code';

  IF v_cur IS DISTINCT FROM ARRAY['ASSET','ATT','AUTH','DASH','GOAL','HR','LEAVE','NOTI',
                                  'PAYROLL','RECRUIT','ROOM','SOCIAL','SYSTEM','TASK']::text[] THEN
    RAISE EXCEPTION '[0592] verify: CHECK chk_dashboard_widgets_module_code sau khi noi la {%}, ky vong du 14 gia tri (13 cu + SOCIAL)',
      coalesce(array_to_string(v_cur, ','), 'KHONG DOC DUOC');
  END IF;
END $$;
--> statement-breakpoint

-- ─────────── (6) Trả lock_timeout về mặc định ───────────
-- `SET LOCAL` sống tới hết TRANSACTION, mà drizzle bọc TẤT CẢ migration pending trong MỘT transaction
-- ⇒ không trả thì nó rò sang mọi migration chạy sau trong cùng lượt (0587:41-48).
SET LOCAL lock_timeout = DEFAULT;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- -- Chạy bằng vai superuser / BYPASSRLS trong MỘT transaction, SAU khi đã hạ API về bản seedVersion v6.
-- -- `dashboard_widget_configs` + `dashboard_widget_cache` cũng tự xoá theo FK ON DELETE CASCADE (xoá CỨNG —
-- -- mất cả tuỳ biến Role / User nếu có).
-- -- Sổ của migrator KHÔNG tự lùi: muốn db:migrate áp lại 0592 về sau thì xoá thêm hàng của nó (chỉ đúng khi
-- -- 0592 là migration cuối đã áp):
-- --   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1717587381000;
-- -- Áp lại 0592 ⇒ hai widget mang UUID mới; kiểm config Company đã được seed lại (8 × số công ty), chưa
-- -- có thì nâng seedVersion.
-- DELETE FROM dashboard_widget_configs WHERE widget_id IN (
--   SELECT id FROM dashboard_widgets WHERE company_id IS NULL
--    AND widget_code IN ('SOCIAL_ENGAGEMENT_WEEK','SOCIAL_NEWS_UNACKED'));
-- DELETE FROM dashboard_widgets WHERE company_id IS NULL
--   AND widget_code IN ('SOCIAL_ENGAGEMENT_WEEK','SOCIAL_NEWS_UNACKED');
-- ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
-- ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
--   CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','ASSET','ROOM','RECRUIT','PAYROLL'));
