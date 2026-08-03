-- S7-CHAT-DB-3 — LEAST-PRIVILEGE trên bề mặt CHAT: gỡ quyền không writer nào dùng, và chặn
-- ON DELETE CASCADE xoá cứng bảng append-only.
--
-- Nguồn: S7-CHAT-BE-GATE-3 lane L3 (M-1 · M-3 · M-4 · M-6). Kế hoạch + toàn bộ SỐ ĐO gốc:
-- `docs/plans/S7-CHAT-DB-3.md` §0. Mọi con số dưới đây đo trên lane `mediaos_s7db3` (chain 0000→0539
-- sạch) TRƯỚC khi viết migration này — không suy từ việc đọc migration cũ.
--
-- ⚠️ VÌ SAO KHÔNG ĐỌC MIGRATION CŨ RỒI KẾT LUẬN. Bản rà tĩnh của lane L3 đọc `0002:70`
-- (`GRANT ... DELETE ON users`) rồi kết luận "app role xoá được users". SAI: `0467` đã REVOKE. Đo bằng
-- `has_table_privilege` cho `f`. Vế `users` vì thế KHÔNG phải việc GRANT — nó là việc FK, mục (D).
--
-- ═══════════ BA LỖ ═══════════
--
-- (L1) `chat_rooms` có UPDATE **CẤP BẢNG** (`has_table_privilege('mediaos_app','chat_rooms','UPDATE')`
--      = `t`) ⇒ app role sửa được cả 22 cột, gồm `company_id`, `id`, `room_type`, `direct_key`,
--      `room_code`, `created_by`. Quét `update(chatRooms)` toàn `apps/api/src`: chỉ **4 writer**, chạm
--      **11 cột**. 11 cột còn lại là quyền chưa ai từng cần. `company_id` là ca nặng nhất — bất biến #1
--      nói cô lập tenant ép ở tầng DB; để ACL cho phép ghi rồi trông vào `WITH CHECK` của policy là dựa
--      vào lớp KHÁC với lớp mà bất biến mô tả.
--
-- (L2) `GRANT UPDATE (visible_from_seq) ON chat_room_members` (0538:258) là **quyền chết**: 0 writer
--      trong `src` (grep `visibleFromSeq` chỉ ra đường ĐỌC + đúng một comment ở
--      `chat-derived-rooms-sync.service.ts:263` dặn "TUYỆT ĐỐI KHÔNG set"). CHAT-DEC-008 (v1: thành viên
--      mới đọc TOÀN BỘ lịch sử) do đó đang được gác bằng một comment + một unit test. Cấp quyền cho một
--      tương lai chưa tới là ngược với least-privilege: cấp lúc cần, một dòng.
--
-- (L3) FK `users` → chat là **ON DELETE CASCADE** (4 constraint). `chat_messages` là append-only theo
--      bất biến #2 — app role không có UPDATE/DELETE cấp bảng. Nhưng CASCADE chạy ở tầng **owner**, qua
--      RI, **bỏ qua mọi GRANT**: một `DELETE FROM users` (script dọn, migration sau, teardown test) xoá
--      CỨNG tin nhắn, im lặng, và để lại lỗ `room_seq` VĨNH VIỄN — `last_message_seq` không giảm ⇒ mẫu
--      số phép trừ đếm chưa đọc phồng lên, đúng cái `0539` vừa đi sửa.
--      `sender_id`/`user_id` đều NOT NULL ⇒ `SET NULL` bất khả thi ⇒ **RESTRICT**.
--
-- ═══════════ THỨ TỰ: REVOKE CẤP BẢNG **TRƯỚC**, GRANT CỘT **SAU** ═══════════
-- ⚠️ Bản đầu của migration này viết ngược lại (GRANT cột trước, REVOKE bảng sau) theo lập luận
--    "expand-contract, hai ACL độc lập nên revoke không đụng column-GRANT". **SAI, và khối VERIFY ở
--    mục (E) đã bắt được ngay lần chạy đầu.** Đo trực tiếp trên lane:
--
--      BEGIN;
--      GRANT UPDATE (name, description) ON chat_rooms TO mediaos_app;   → attacl = {name,description}
--      REVOKE UPDATE ON chat_rooms FROM mediaos_app;                    → attacl = {}          ← MẤT SẠCH
--
--    Đúng như tài liệu Postgres về REVOKE: *"When revoking privileges on a table, the corresponding
--    column privileges (if any) are automatically revoked on each column of the table, as well."*
--    ⇒ GRANT-rồi-REVOKE để lại `chat_rooms` **KHÔNG cột nào UPDATE được** = đúng cửa sổ 500 mà thứ tự
--    đó định tránh, chỉ khác là vĩnh viễn thay vì tạm thời.
--
-- KHÔNG có cửa sổ 500 nào cho thứ tự REVOKE-trước: `migrate()` của drizzle chạy migration trong MỘT
-- transaction (đã chứng minh: lần VERIFY đỏ ở trên hoàn nguyên sạch, `chat_rooms` giữ nguyên UPDATE cấp
-- bảng). Thay đổi ACL là transactional — phiên khác thấy hoặc trạng thái CŨ hoặc trạng thái MỚI, không
-- bao giờ thấy khoảng giữa. "Expand-contract" ở WO này vì thế nằm ở KẾT QUẢ (tập cột writer đang dùng
-- không mất cột nào), không nằm ở thứ tự câu lệnh.
--
-- ═══════════ AI BỊ ẢNH HƯỞNG ═══════════
-- Đo `has_table_privilege` cho 5 role `mediaos*` trên 3 bảng chat: chỉ `mediaos_app` có quyền ghi.
-- `mediaos_worker` / `mediaos_readonly` / `mediaos_owner` = 0 quyền (job đối soát derived-room đi qua
-- `db.withTenant`, tức pool APP, không phải pool worker) ⇒ revoke trên một role là đủ, không sót đường.

-- ═══════════════ (A) gỡ vế CẤP BẢNG trên chat_rooms ═══════════════
-- Phải chạy TRƯỚC (B): REVOKE cấp bảng cuốn theo mọi column-GRANT của chính bảng đó (xem khối trên).
REVOKE UPDATE ON chat_rooms FROM mediaos_app;
--> statement-breakpoint

-- ═══════════════ (B) cấp lại ĐÚNG tập cột 4 writer thật đang dùng ═══════════════
-- bumpRoomSeq   (chat-messages.repository.ts:86) → last_message_seq, last_message_at
-- restoreRoom   (chat-rooms.repository.ts:336)   → deleted_at, deleted_by
-- updateRoom    (chat-rooms.repository.ts:349)   → name, description, updated_at, updated_by
-- archiveRoom   (chat-rooms.repository.ts:369)   → is_archived, archived_at, archived_by, updated_at
--
-- CỐ Ý KHÔNG CẤP: company_id · id · room_type · room_code · direct_key · ref_id · channel_id ·
-- org_unit_id · created_at · created_by · sync_source · synced_at.
-- `sync_source`/`synced_at` chỉ được ghi trong câu INSERT (chat-rooms.repository.ts:131-155) — job đối
-- soát chỉ gọi restoreRoom/archiveRoom, không đóng dấu lại. Cần sau thì cấp sau.
--
-- ⚠️ Tập này suy được vì `chatRooms` KHÔNG có `$onUpdate` nào trong schema — drizzle ghi đúng cột trong
--    `.set()`, không tự chèn thêm. Thêm `$onUpdate` sau này mà quên cấp cột = 42501 lúc chạy; lưới bắt
--    là mục H của `s7-chat-db1-invariants.int-spec.ts` (chạy đường ghi thật của cả 4 writer).
GRANT UPDATE (
  name, description,
  is_archived, archived_at, archived_by,
  last_message_at, last_message_seq,
  updated_at, updated_by,
  deleted_at, deleted_by
) ON chat_rooms TO mediaos_app;
--> statement-breakpoint

-- ═══════════════ (C) gỡ column-GRANT chết ═══════════════
-- Revoke thẳng an toàn ở đây (khác chat_rooms): 0 writer ⇒ không có cửa sổ nào để mở.
REVOKE UPDATE (visible_from_seq) ON chat_room_members FROM mediaos_app;
--> statement-breakpoint

-- ═══════════════ (D) FK users → chat: CASCADE → RESTRICT ═══════════════
-- Đổi CẢ BỐN (2 một-cột + 2 composite). Để lệch một cái là vô nghĩa: Postgres kiểm mọi FK, nhưng nếu
-- constraint một-cột còn CASCADE thì hàng con vẫn bị xoá trước khi composite kịp chặn ở một số thứ tự.
--
-- ⚠️ KHÔNG DROP constraint một-cột dù composite bao hàm nó. Drop là đổi HÌNH DẠNG FK — ngoài phạm vi WO
--    và chạm giả định của `xtenant-fk-ratchet.int-spec.ts` (ca (a) duyệt FK một-cột; "waiver mồ côi" đỏ
--    khi cặp biến mất). Việc dọn constraint dư thuộc S7-CHAT-CLEAN-2, phải đo trước.
--
-- ⚠️ Vì sao RESTRICT chứ không NO ACTION: NO ACTION cho phép hoãn kiểm tới cuối câu lệnh, nên một
--    `DELETE users; INSERT users;` trong cùng tx vẫn lọt. RESTRICT kiểm NGAY — muốn xoá user thì phải
--    xử lý tin nhắn tường minh trước, đúng ý đồ "không xoá cứng append-only trong im lặng".
--
-- ⚠️ Đường xoá tenant của test KHÔNG vỡ: `cleanupTenants` (test/helpers/seed.ts, mở ở 397) đã xoá
--    chat_messages/chat_room_members/chat_rooms ở **489-491**, trước `DELETE FROM users` ở **670**,
--    trong CÙNG hàm. Đo trước khi đổi — đây là caller hard-delete `users` DUY NHẤT trong repo.
ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_sender_id_fkey;
--> statement-breakpoint
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_sender_id_company_fk;
--> statement-breakpoint
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_sender_id_company_fk
  FOREIGN KEY (company_id, sender_id) REFERENCES users(company_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE chat_room_members DROP CONSTRAINT chat_room_members_user_id_fkey;
--> statement-breakpoint
ALTER TABLE chat_room_members ADD CONSTRAINT chat_room_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE chat_room_members DROP CONSTRAINT chat_room_members_user_id_company_fk;
--> statement-breakpoint
ALTER TABLE chat_room_members ADD CONSTRAINT chat_room_members_user_id_company_fk
  FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE RESTRICT;
--> statement-breakpoint

-- ═══════════════ (E) VERIFY FAIL-LOUD — siết so với khối của 0539 ═══════════════
-- Khối VERIFY của `0539` bước (3) đếm `information_schema.table_privileges` cho `chat_messages`. Ba lỗ,
-- và mục này đóng cả ba (KHÔNG sửa `0539` — file đã áp trên mọi lane + CI, sửa là đổi hash, hỏng journal
-- drizzle; bản pin mới sống ở đây):
--   1. thiếu vế schema ⇒ một `chat_messages` ở schema khác cũng lọt vào phép đếm;
--   2. MÙ HOÀN TOÀN với column-GRANT — `GRANT UPDATE (body) ON chat_messages` không xuất hiện trong
--      `table_privileges` ⇒ bất biến #2 bị phá mà VERIFY vẫn in "OK";
--   3. không assert RLS ⇒ `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` ở migration sau đi qua im lặng.
--
-- Dùng `aclexplode(relacl/attacl)` thay `information_schema`: chính xác từng CẤP (bảng vs cột) và không
-- phụ thuộc "role hiện tại là grantor hay grantee" như view của information_schema.
-- Mọi truy vấn neo `nspname='public'` (memory `audit-check-union-parse-anchor-trap`: thiếu neo ⇒ PASS oan).
DO $$
DECLARE
  v_tbl   text;
  v_want  text[];
  v_got   text[];
  v_bad   int;
BEGIN
  -- (1) KHÔNG bảng chat nào còn UPDATE/DELETE CẤP BẢNG cho mediaos_app.
  --     has_table_privilege chỉ trả `t` cho quyền CẤP BẢNG — column-GRANT không làm nó `t`, nên đây
  --     đúng là primitive cần dùng (đã đối chứng: chat_messages có 4 column-GRANT mà vẫn `f`).
  SELECT count(*) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('chat_messages', 'chat_room_members', 'chat_rooms')
     AND (has_table_privilege('mediaos_app', c.oid, 'UPDATE')
       OR has_table_privilege('mediaos_app', c.oid, 'DELETE'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0540] % bang chat con UPDATE/DELETE CAP BANG cho mediaos_app', v_bad;
  END IF;

  -- (2) Tập cột UPDATE-được phải BẰNG ĐÚNG tập cho phép — không "≤", không "count > 0".
  --     Pin theo TÊN: cấp thừa một cột là đỏ, gỡ nhầm một cột cũng đỏ.
  --     COLLATE "C" cho thứ tự tất định, không phụ thuộc collation của cụm.
  FOR v_tbl, v_want IN
    SELECT * FROM (VALUES
      ('chat_messages',     ARRAY['pinned_at','pinned_by','recalled_at','recalled_by']),
      ('chat_room_members', ARRAY['last_read_at','last_read_seq','left_at','muted_until','role']),
      ('chat_rooms',        ARRAY['archived_at','archived_by','deleted_at','deleted_by','description',
                                  'is_archived','last_message_at','last_message_seq','name',
                                  'updated_at','updated_by'])
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
      RAISE EXCEPTION '[0540] %: tap cot UPDATE-duoc = %, ky vong %', v_tbl, v_got, v_want;
    END IF;
  END LOOP;

  -- (3) Bốn FK users→chat phải ON DELETE RESTRICT ('r'). Đếm ĐỦ 4, không chỉ "không có cái nào CASCADE"
  --     — mất một constraint cũng là hỏng, và phép đếm âm sẽ PASS oan khi constraint biến mất.
  SELECT count(*) INTO v_bad
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE con.contype = 'f' AND n.nspname = 'public'
     AND con.confrelid = 'public.users'::regclass
     AND con.conname IN ('chat_messages_sender_id_fkey', 'chat_messages_sender_id_company_fk',
                         'chat_room_members_user_id_fkey', 'chat_room_members_user_id_company_fk')
     AND con.confdeltype = 'r';
  IF v_bad <> 4 THEN
    RAISE EXCEPTION '[0540] chi % / 4 FK users->chat la ON DELETE RESTRICT', v_bad;
  END IF;

  -- (4) RLS + FORCE còn bật trên cả 3 bảng (bất biến #1 — owner cũng không được vượt).
  SELECT count(*) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('chat_messages', 'chat_room_members', 'chat_rooms')
     AND (c.relrowsecurity IS NOT TRUE OR c.relforcerowsecurity IS NOT TRUE);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0540] % bang chat mat RLS hoac FORCE RLS', v_bad;
  END IF;

  RAISE NOTICE '[0540] VERIFY OK: 0 quyen cap bang · tap cot khop pin · 4 FK RESTRICT · RLS+FORCE con bat';
END;
$$;
--> statement-breakpoint

-- ─────────── ĐƯỜNG LÙI (không chạy — comment) ───────────
-- Hoàn nguyên là NỚI quyền, nên chỉ làm khi có bằng chứng 42501 trên đường ghi thật:
--   GRANT UPDATE ON chat_rooms TO mediaos_app;            -- trả lại vế cấp bảng (L1)
--   GRANT UPDATE (visible_from_seq) ON chat_room_members TO mediaos_app;   -- (L2)
--   ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_sender_id_fkey;
--   ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_sender_id_fkey
--     FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;      -- (L3, và 3 FK còn lại)
-- ⚠️ Lùi vế (D) là mở lại đường xoá cứng `chat_messages`. Nếu chỉ vì một caller cần xoá user, cách đúng
--    là caller đó dọn chat tường minh trước (như `cleanupTenants` đang làm), KHÔNG phải trả lại CASCADE.
