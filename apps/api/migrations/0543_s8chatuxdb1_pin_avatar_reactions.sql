-- S8-CHAT-UX-DB-1 — NỀN DB cho wave nâng cấp giao diện CHAT (ghim · avatar phòng · thả cảm xúc).
--
-- Nguồn: DB-12 §6.7 · SPEC-15 §5.1b · CHAT-DEC-015 (ghim per-user) · CHAT-DEC-016 (ai đặt avatar) ·
-- CHAT-DEC-018 (reaction bảng riêng). Kế hoạch + TOÀN BỘ số đo gốc: docs/plans/S8-CHAT-UX-DB-1.md §0.
-- Mọi con số dưới đây đo trên lane `mediaos_s8db1` (chain 0000→0542 sạch, 210/210) TRƯỚC khi viết file
-- này, đối chứng trên `mediaos` — KHÔNG suy từ việc đọc migration cũ (bài học 0540 header).
--
-- ═══════════ ⛔ ĐÍNH CHÍNH MỘT TIỀN ĐỀ SAI CỦA WO VÀ CỦA DB-12 §6.7 ═══════════
-- Cả hai đều ghi (đo 05/08): "`chat_messages` CHƯA có UNIQUE (company_id, id) … không thêm thì
-- ADD CONSTRAINT … REFERENCES chat_messages (company_id, id) LỖI NGAY lúc migrate", kèm câu lệnh
-- `ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_company_id_id_uq UNIQUE (company_id, id)`.
--
-- Phép đo đó chỉ nhìn `0535` (đúng: `chat_messages` KHÔNG nằm trong danh sách 63 bảng) và BỎ SÓT
-- `0538:279`, nơi wave S7 đã tự thêm constraint này để đỡ FK tự tham chiếu `reply_to_message_id`:
--     0538:277  -- chat_messages CHƯA có (company_id,id) UNIQUE (đo 02/08 …)
--     0538:279  ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_company_id_id_uq UNIQUE (…);
-- Đo lại 06/08 trên CẢ `mediaos_s8db1` LẪN `mediaos`: constraint TỒN TẠI (count = 1). Ngoài ra
-- `0541:114` và `0542:167` ghi "⛔ CẤM DROP", và `s7-chat-db1-invariants.int-spec.ts:934` đang pin nó.
--
-- ⇒ Chạy đúng như DB-12 viết thì `0543` chết ngay dòng đầu với **42710 duplicate_object** — NGƯỢC LẠI
--   với thất bại mà WO dự báo. Vì vậy mục (0) dưới đây là TIỀN KIỂM ASSERT, không phải ADD CONSTRAINT.
--   (memory `wo-seed-hand-measurements-can-be-incomplete`. DB-12 §6.7 đã được đính chính cùng commit.)
--
-- ═══════════ THUẦN ADDITIVE — KHÔNG MỘT CÂU `REVOKE` NÀO ═══════════
-- `0540` đã REVOKE vế UPDATE cấp bảng của `chat_rooms` rồi GRANT lại theo 11 CỘT. Postgres:
--   "When revoking privileges on a table, the corresponding column privileges (if any) are
--    automatically revoked on each column of the table, as well."
-- ⇒ một câu `REVOKE UPDATE ON chat_rooms` ở đây cuốn sạch cả 11 cột đang cấp, để lại bảng KHÔNG cột
-- nào ghi được, VĨNH VIỄN (memory `revoke-table-grant-wipes-column-grants`). File này CHỈ GRANT THÊM.
-- Tập cột sau 0543: chat_rooms 11 → 12 · chat_room_members 5 → 7. Khối VERIFY mục (E) pin bằng `=`.
--
-- ═══════════ BẤT BIẾN #2 (không hard-delete) — reaction KHÔNG vi phạm ═══════════
-- Nhóm append-only theo CLAUDE.md §2 là audit/snapshot/ledger: audit_logs · login_logs ·
-- attendance_logs · … và `chat_messages` (nội dung trao đổi). Một reaction là TRẠNG THÁI HIỆN TẠI của
-- một nút bấm bật/tắt, không phải dấu vết cần đối chứng; giữ lại hàng đã bỏ thả chỉ tạo rác và buộc
-- mọi phép đếm thêm vế lọc. Vì vậy app role CÓ `DELETE` trên `chat_message_reactions` — và CHỈ bảng
-- này trong cụm CHAT. Ba bảng chat cũ giữ nguyên 0 quyền UPDATE/DELETE cấp bảng (VERIFY mục (E)(2)).

-- ═══════════════ (0) TIỀN KIỂM: 3 đích composite FK phải còn sống ═══════════════
-- Fail-loud bằng tiếng Việt chỉ đúng chỗ, thay vì để `ADD FK` ném 42830 khó đọc — hoặc tệ hơn, để
-- `ADD CONSTRAINT` mù ném 42710 như bản phác trong DB-12.
DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_company_id_id_uq') THEN
    v_missing := v_missing || 'chat_messages_company_id_id_uq (0538:279)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_company_id_id_uq') THEN
    v_missing := v_missing || 'files_company_id_id_uq (0535)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_company_id_id_uq') THEN
    v_missing := v_missing || 'users_company_id_id_uq (0533)';
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0543] thieu dich cho composite FK: % — KHONG duoc tu them, phai truy vi sao no bien mat', v_missing;
  END IF;
  RAISE NOTICE '[0543] (0) tien kiem OK: 3 dich composite FK (chat_messages/files/users) deu con';
END $preflight$;
--> statement-breakpoint

-- ═══════════════ (A) chat_room_members: ghim per-user + đánh dấu chưa đọc ═══════════════
-- CHAT-DEC-015: ghim đặt Ở BẢNG THÀNH VIÊN, không phải `chat_rooms` — ghim ở bảng phòng nghĩa là một
-- người ghim thì CẢ PHÒNG bị ghim cho mọi người. Trần 10 phòng/người ép ở SERVICE (BE-1), không ở DB:
-- ràng buộc "đếm ≤ 10" cần trigger/exclusion, đắt hơn giá trị nó mang ở đây.
--
-- ⚠️ `marked_unread_at` là cột RIÊNG, KHÔNG được hiện thực bằng cách lùi `last_read_seq` — con trỏ
--    chỉ-tiến là bất biến (SPEC-15 §13.2 · CHAT-ERR-018).
--
-- KHÔNG tạo index: `idx_chat_members_user_active (company_id, user_id) WHERE left_at IS NULL` đã phục
-- vụ cả phép đếm trần lẫn phép sắp `pinned_at DESC` trên tập vài chục hàng/người. Thêm index ở đây là
-- đẻ một cái `idx_scan = 0` mà về sau không ai dám drop (memory `idx-scan-zero-is-not-unused`).
ALTER TABLE chat_room_members
  ADD COLUMN pinned_at        timestamptz,
  ADD COLUMN marked_unread_at timestamptz;
--> statement-breakpoint

-- ═══════════════ (B) chat_rooms.avatar_file_id — COMPOSITE tenant FK ═══════════════
ALTER TABLE chat_rooms ADD COLUMN avatar_file_id uuid;
--> statement-breakpoint

-- ⚠️ CHỈ composite, KHÔNG kèm FK một-cột. Kiểm tra FK của Postgres chạy quyền hệ thống và KHÔNG áp RLS
--    ⇒ FK một-cột `avatar_file_id → files(id)` cho phép ngữ cảnh tenant A trỏ sang file của B (lớp lỗ
--    KI-046). Thêm nó chỉ để "cho có" sẽ tạo một CẶP MỚI trong fk-tenant-census, cặp đó chỉ xanh nhờ
--    composite phủ lên — không tạo thì census không có gì để đếm. Khuôn giống archived_by/updated_by/
--    deleted_by của chính bảng này (0538): cột uuid trần + duy nhất một composite FK.
--
-- ⚠️ `ON DELETE SET NULL` PHẢI kèm DANH SÁCH CỘT. Dạng trần null LUÔN `company_id` (cột NOT NULL mang
--    tenant) ⇒ 23502 khi xoá file; 279/446 cặp của 0535 rơi vào bẫy này, ratchet ca (f) canh nó.
ALTER TABLE chat_rooms
  ADD CONSTRAINT chat_rooms_avatar_file_id_company_fk
  FOREIGN KEY (company_id, avatar_file_id) REFERENCES files (company_id, id)
  ON DELETE SET NULL (avatar_file_id);
--> statement-breakpoint

-- CHAT-DEC-016: phòng `direct` KHÔNG có avatar riêng — avatar DẪN XUẤT từ người đối thoại.
-- ⚠️ Đây là đai THỨ HAI. BE-2 phải từ chối trước bằng lỗi nghiệp vụ có mã; để rơi xuống DB thì người
--    dùng nhận 500 vì 23514. DB chỉ là lưới chống đường ghi tương lai quên luật.
ALTER TABLE chat_rooms
  ADD CONSTRAINT chk_chat_rooms_avatar_direct
  CHECK (room_type <> 'direct' OR avatar_file_id IS NULL);
--> statement-breakpoint

-- ═══════════════ (C) GRANT — CHỈ THÊM CỘT (xem khối cảnh báo ở đầu file) ═══════════════
GRANT UPDATE (avatar_file_id) ON chat_rooms TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (pinned_at, marked_unread_at) ON chat_room_members TO mediaos_app;
--> statement-breakpoint

-- ═══════════════ (D) chat_message_reactions — BẢNG MỚI ═══════════════
-- Vì sao BẢNG RIÊNG chứ không cột jsonb trên `chat_messages` (DB-12 §6.7): `chat_messages` là
-- append-only; nhét reaction vào jsonb buộc UPDATE cột đó mỗi lần ai thả/bỏ — vừa phải cấp thêm
-- column-GRANT trên bảng ledger, vừa tạo đường đua ghi-đè (hai người thả cùng lúc, người sau đè người
-- trước). Bảng riêng: mỗi reaction một hàng độc lập, DELETE không đụng ledger.
--
-- BA CHỖ LỆCH CÓ CHỦ Ý so với bản phác DB-12 §6.7 (chi tiết + lý do: plan §2.3):
--   1. `user_id` dùng COMPOSITE FK, không phải `REFERENCES users(id)` một cột — FK một-cột giữa hai
--      bảng đều có company_id làm `xtenant-fk-ratchet` ca (a) ĐỎ ngay trên CI (file gate hasDb).
--   2. unique 4 cột `(company_id, message_id, user_id, emoji)` — bản phác ghi 3 cột, wave doc dòng 75
--      ghi 4. Chọn 4: KHÔNG nới lỏng gì (composite FK ép một message_id ứng đúng một company_id) mà
--      cột dẫn đầu company_id khớp khuôn index toàn repo và dùng lại được cho truy vấn tổng hợp.
--   3. KHÔNG tạo index phụ `(company_id, message_id)` — nó là TIỀN TỐ CHẶT của unique 4 cột ở trên,
--      đúng loại index trùng mà `0541` vừa đi dọn.
--
-- ⚠️ `ON DELETE CASCADE` từ `users` — vì sao khác lựa chọn RESTRICT của 0540: 0540 đổi 4 FK users→chat
--    sang RESTRICT vì CASCADE chạy tầng owner, bỏ qua GRANT, nên nó XOÁ CỨNG `chat_messages`
--    append-only và để lại lỗ `room_seq` vĩnh viễn. Reaction không thuộc nhóm đó và không mang seq:
--    xoá user thì các nút bấm của người đó biến mất, đúng ngữ nghĩa. Kèm theo, `cleanupTenants` KHÔNG
--    cần thêm dòng nào — `DELETE FROM chat_messages` (test/helpers/seed.ts:599) đã cascade sang
--    reaction TRƯỚC khi tới `DELETE FROM users`.
CREATE TABLE chat_message_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ⚠️ DEFAULT theo GUC là KHUÔN CHUNG của mọi bảng tenant (chat_rooms · chat_room_members ·
  --    chat_messages · goals · notification_preferences đều có). Thiếu nó thì `withTenant` +
  --    `insert(...).values({messageId, userId, emoji})` của drizzle BỎ QUA cột company_id (schema khai
  --    `.default(currentCompanyDefault)` nghĩa là "DB tự điền") ⇒ 23502 lúc chạy ở BE-3.
  company_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
             REFERENCES companies(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  emoji      varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chat_message_reactions_message_id_company_fk
    FOREIGN KEY (company_id, message_id) REFERENCES chat_messages (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT chat_message_reactions_user_id_company_fk
    FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id)
    ON DELETE CASCADE,

  -- Bộ emoji ĐÓNG, ép ở DB chứ không chỉ ở Zod: chuỗi tự do là bề mặt lưu trữ vô hạn.
  -- ⚠️ Bộ này sống ở HAI chỗ (CHECK đây + Zod ở BE-3). Thêm emoji thứ 7 phải sửa CẢ HAI.
  CONSTRAINT chat_message_reactions_emoji_chk
    CHECK (emoji IN ('like','love','haha','wow','sad','angry'))
);
--> statement-breakpoint

-- ── RLS TRƯỚC mọi lối ghi (CLAUDE.md §3) — khuôn literal-GUC của 0479/0495/0504 ──
-- Bảng sinh ra RỖNG nên không có backfill nào, nhưng giữ đúng thứ tự để khuôn không bị sao chép sai.
ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_message_reactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON chat_message_reactions;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON chat_message_reactions
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- 1 người / 1 tin / 1 emoji — cùng người vẫn thả được NHIỀU emoji khác nhau trên cùng một tin.
CREATE UNIQUE INDEX chat_message_reactions_uq
  ON chat_message_reactions (company_id, message_id, user_id, emoji);
--> statement-breakpoint

-- KHÔNG `GRANT UPDATE`: đổi cảm xúc = DELETE + INSERT, không cột nào cần sửa tại chỗ.
-- KHÔNG cấp cho mediaos_worker/mediaos_readonly: 0 job đọc reaction (least-privilege, tinh thần 0540).
-- Cần thì cấp sau, một dòng.
GRANT SELECT, INSERT, DELETE ON chat_message_reactions TO mediaos_app;
--> statement-breakpoint

-- ═══════════════ (E) VERIFY FAIL-LOUD ═══════════════
-- Khuôn 0540 mục (E): `aclexplode` thay `information_schema` (chính xác từng CẤP bảng-vs-cột, không
-- phụ thuộc role hiện tại là grantor hay grantee), mọi truy vấn NEO `nspname='public'` — thiếu neo là
-- PASS oan (memory `audit-check-union-parse-anchor-trap`).
--
-- Khối này chỉ chạy ĐÚNG MỘT LẦN lúc migrate; đai giữ về sau là mục I của
-- `s7-chat-db1-invariants.int-spec.ts`. Hai đai, hai vòng đời — migration chạy trên PROD/dev-online
-- nơi vitest KHÔNG chạy, còn int-spec bắt được mọi WO sau làm trôi.
DO $verify$
DECLARE
  v_tbl  text;
  v_want text[];
  v_got  text[];
  v_bad  int;
  v_def  text;
BEGIN
  -- (1) Tập cột UPDATE-được phải BẰNG ĐÚNG pin mới. `=` chứ không `⊇`: cấp thừa một cột cũng đỏ.
  FOR v_tbl, v_want IN
    SELECT * FROM (VALUES
      ('chat_room_members', ARRAY['last_read_at','last_read_seq','left_at','marked_unread_at',
                                  'muted_until','pinned_at','role']),
      ('chat_rooms',        ARRAY['archived_at','archived_by','avatar_file_id','deleted_at','deleted_by',
                                  'description','is_archived','last_message_at','last_message_seq',
                                  'name','updated_at','updated_by'])
    ) t(tbl, cols)
  LOOP
    SELECT coalesce(array_agg(a.attname::text ORDER BY a.attname COLLATE "C"), '{}')
      INTO v_got
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE n.nspname = 'public' AND c.relname = v_tbl
       AND acl.grantee = 'mediaos_app'::regrole AND acl.privilege_type = 'UPDATE';

    IF v_got IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION '[0543] %: tap cot UPDATE-duoc = %, ky vong %', v_tbl, v_got, v_want;
    END IF;
  END LOOP;

  -- (2) KHÔNG bảng chat CŨ nào có UPDATE/DELETE cấp bảng (GRANT thêm cột không được nới cấp bảng).
  SELECT count(*) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('chat_messages', 'chat_room_members', 'chat_rooms')
     AND (has_table_privilege('mediaos_app', c.oid, 'UPDATE')
       OR has_table_privilege('mediaos_app', c.oid, 'DELETE'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0543] % bang chat cu bi noi len UPDATE/DELETE CAP BANG', v_bad;
  END IF;

  -- (3) FK avatar: 2 cột, SET NULL, và `confdelsetcols` KHÁC RỖNG (SET NULL trần null luôn company_id).
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'chat_rooms_avatar_file_id_company_fk';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '[0543] thieu FK chat_rooms_avatar_file_id_company_fk';
  END IF;
  SELECT count(*) INTO v_bad
    FROM pg_constraint
   WHERE conname = 'chat_rooms_avatar_file_id_company_fk'
     AND array_length(conkey, 1) = 2
     AND confdeltype = 'n'
     AND coalesce(array_length(confdelsetcols, 1), 0) = 1;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '[0543] FK avatar sai hinh dang (phai 2 cot + SET NULL co danh sach cot): %', v_def;
  END IF;

  -- (4) Bảng reaction: RLS + FORCE.
  SELECT count(*) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'chat_message_reactions'
     AND c.relrowsecurity IS TRUE AND c.relforcerowsecurity IS TRUE;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '[0543] chat_message_reactions thieu RLS hoac FORCE RLS';
  END IF;

  -- (5) Policy tenant phải có ĐỦ CẢ HAI vế: USING (đọc) và WITH CHECK (ghi).
  --     Thiếu WITH CHECK ⇒ đọc thì cô lập mà GHI thì trồng được hàng sang tenant khác.
  SELECT count(*) INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'chat_message_reactions'
     AND policyname = 'tenant_isolation'
     AND qual IS NOT NULL AND with_check IS NOT NULL;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '[0543] policy tenant_isolation tren chat_message_reactions thieu USING hoac WITH CHECK';
  END IF;

  -- (6) Quyền cấp bảng = ĐÚNG {SELECT, INSERT, DELETE}. Pin bằng `=`: có UPDATE là đỏ.
  -- ⚠️ DISTINCT phải nằm ở SUBQUERY, không viết `array_agg(DISTINCT x ORDER BY x COLLATE "C")`:
  --    biểu thức ORDER BY lúc đó khác biểu thức DISTINCT ⇒ Postgres ném 42P10 ("ORDER BY expressions
  --    must appear in select list"). Đã đo: bản đầu của khối này chết đúng ở đây lúc migrate thử.
  SELECT coalesce(array_agg(p ORDER BY p COLLATE "C"), '{}')
    INTO v_got
    FROM (
      SELECT DISTINCT acl.privilege_type::text AS p
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) acl
       WHERE n.nspname = 'public' AND c.relname = 'chat_message_reactions'
         AND acl.grantee = 'mediaos_app'::regrole
    ) s;
  IF v_got IS DISTINCT FROM ARRAY['DELETE','INSERT','SELECT'] THEN
    RAISE EXCEPTION '[0543] quyen cap bang cua mediaos_app tren chat_message_reactions = %, ky vong {DELETE,INSERT,SELECT}', v_got;
  END IF;

  -- (7) Hai composite FK của bảng reaction đều 2 cột + ON DELETE CASCADE.
  SELECT count(*) INTO v_bad
    FROM pg_constraint
   WHERE conrelid = 'public.chat_message_reactions'::regclass
     AND contype = 'f'
     AND conname IN ('chat_message_reactions_message_id_company_fk',
                     'chat_message_reactions_user_id_company_fk')
     AND array_length(conkey, 1) = 2
     AND confdeltype = 'c';
  IF v_bad <> 2 THEN
    RAISE EXCEPTION '[0543] chi % / 2 composite FK cua chat_message_reactions dung hinh dang', v_bad;
  END IF;

  -- (7b) `company_id` phải có DEFAULT theo GUC — khuôn chung của mọi bảng tenant. Thiếu nó thì
  --      đường ghi của drizzle (schema khai `.default(currentCompanyDefault)`) bỏ qua cột ⇒ 23502.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'chat_message_reactions'
       AND column_name = 'company_id'
       AND column_default LIKE '%app.current_company_id%'
  ) THEN
    RAISE EXCEPTION '[0543] chat_message_reactions.company_id thieu DEFAULT theo GUC app.current_company_id';
  END IF;

  -- (8) CHECK emoji + unique 4 cột còn đó.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'chat_message_reactions_emoji_chk' AND contype = 'c') THEN
    RAISE EXCEPTION '[0543] thieu CHECK bo emoji dong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
                  WHERE i.relname = 'chat_message_reactions_uq' AND x.indisunique
                    AND array_length(x.indkey::int2[], 1) = 4) THEN
    RAISE EXCEPTION '[0543] thieu unique 4 cot chat_message_reactions_uq';
  END IF;

  RAISE NOTICE '[0543] VERIFY OK: cot GRANT 12/7 khop pin · 0 quyen cap bang moi tren bang cu · FK avatar dung hinh dang · reaction RLS+FORCE+policy 2 ve · quyen {S,I,D} · 2 composite FK · CHECK emoji · unique 4 cot';
END $verify$;
--> statement-breakpoint

-- ─────────── ĐƯỜNG LÙI (không chạy — comment) ───────────
-- Hoàn nguyên là NỚI quyền + XOÁ dữ liệu, chỉ làm khi có bằng chứng hỏng đường ghi thật:
--   DROP TABLE IF EXISTS chat_message_reactions;          -- bảng RỖNG ở thời điểm ship
--   ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_avatar_file_id_company_fk;
--   ALTER TABLE chat_rooms DROP CONSTRAINT chk_chat_rooms_avatar_direct;
--   ALTER TABLE chat_rooms DROP COLUMN avatar_file_id;
--   ALTER TABLE chat_room_members DROP COLUMN pinned_at, DROP COLUMN marked_unread_at;
-- ⚠️ TUYỆT ĐỐI KHÔNG lùi bằng `REVOKE UPDATE ON <bang>` — nó cuốn sạch column-GRANT của 11 cột kia
--    (khối cảnh báo đầu file). `DROP COLUMN` gỡ đúng quyền của riêng cột đó, không đụng cột khác.
-- ⚠️ Sau khi BE-1/BE-2/BE-3 ship, DROP COLUMN là đổi hình dạng CÓ CONSUMER SỐNG ⇒ phải đi
--    expand-contract 2 release (memory `migration-expand-contract-required`).
