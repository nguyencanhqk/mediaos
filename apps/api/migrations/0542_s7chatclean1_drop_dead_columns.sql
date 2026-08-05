-- S7-CHAT-CLEAN-1 — bước CONTRACT của expand-contract cụm CHAT (DB-12 §6.6 · SPEC-15 §5.3).
-- Gỡ ba cột khai tử cùng toàn bộ index/khoá ngoại bám theo:
--   · chat_rooms.channel_id      → `channels` là bảng media OUT-OF-SCOPE sau de-media-fy
--   · chat_messages.file_url     → URL trần, rò tệp không qua kiểm quyền
--   · chat_messages.file_name    → như trên
-- Đính kèm thật đi qua FOUNDATION `files` + `file_links` + URL ký hạn ngắn (S7-CHAT-BE-3, SPEC-15 §13.5).
--
-- DESTRUCTIVE-APPROVED: 3 cột khai tử (chat_rooms.channel_id, chat_messages.file_url/file_name)
--   — 0 hàng PROD, 0 tham chiếu code, release TÁCH khỏi 0538 đã deploy (Cian)
--
-- ═══════════════ ĐIỀU KIỆN VÀO — ĐÃ ĐO 2026-08-05, KHÔNG SUY LUẬN ═══════════════
-- Đo bằng psql trên đúng cụm đang chạy (`mediaos-postgres` 127.0.0.1:5432), DB `mediaos` = PROD:
--
--   chat_rooms tổng                            23      (department=11 · project=12 ⇒ 0 phòng loại 'channel')
--   chat_rooms WHERE channel_id IS NOT NULL     0   ✅
--   chat_messages tổng                          0   ✅
--   chat_messages WHERE file_url  IS NOT NULL   0   ✅
--   chat_messages WHERE file_name IS NOT NULL   0   ✅
--
-- ⚠️ ĐÍNH CHÍNH vế "dev-online" của done_when: DB `mediaos_dev` **KHÔNG TỒN TẠI** trên cụm này
--   (`pg_database` có đúng 9 hàng: mediaos · 5 lane DB · postgres · template0/1). dev-online chưa
--   provision ⇒ không có dữ liệu để mất, nhưng đó là "không tồn tại", KHÔNG phải "đã xác minh 0 hàng".
--   Ai chạy `m dev-online-db` sau này dựng DB từ đầu chuỗi migration ⇒ đã gồm 0542, không có gì lệch.
--
-- TÁCH RELEASE (vế dễ bỏ sót nhất — memory `migration-expand-contract-required`): gộp expand+contract
-- vào MỘT release là mở cửa sổ 500 cho tiến trình cũ còn chạy. Bằng chứng release N đã đóng:
--   · cột do 0538 tạo CÓ MẶT trên PROD: room_code · sync_source · last_message_seq
--   · index do 0541 gỡ ĐÃ BIẾN MẤT: chat_messages_company_id_idx · chat_messages_room_id_idx
-- Đệm thứ hai, độc lập với luật: CHAT chưa live (`modules.is_active = false`) và chat_messages 0 hàng
-- ⇒ không tiến trình nào đang đọc ba cột này ngay cả trong cửa sổ deploy.
--
-- ═══════════════ VÌ SAO VIẾT (A)–(C) TƯỜNG MINH KHI `DROP COLUMN` TỰ DỌN CHÚNG ═══════════════
-- Vì tự-dọn là IM LẶNG. Viết ra thì tên constraint nằm trong file (người sau đọc được), `IF EXISTS`
-- bảo vệ chuỗi chạy lại, và khối VERIFY có cái để đối chiếu. Đây cũng đúng thứ tự DB-12 §6.6 ghi —
-- lệch khỏi doc thiết kế mà không nói là drift.
--
-- Trạng thái đo được trước khi chạy (để lần sau không phải đoán tên):
--   chat_rooms_channel_id_fkey        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
--   chat_rooms_channel_id_company_fk  FOREIGN KEY (company_id, channel_id)
--                                     REFERENCES channels(company_id, id) ON DELETE SET NULL (channel_id)
--   chat_rooms_channel_uq             UNIQUE INDEX (company_id, channel_id) WHERE channel_id IS NOT NULL
--
-- ⛔ KHÔNG `CASCADE`. Nếu có object ngoài dự kiến bám vào cột, ta MUỐN migration ĐỎ để đọc thông báo,
--    không muốn nó lặng lẽ kéo theo. Đã soi trước trên PROD: 0 view · 0 matview · 0 function nào nhắc
--    `chat_rooms`; policy duy nhất là `chat_rooms_tenant_isolation` và nó chỉ đọc `company_id`.
--
-- QUYỀN: `channel_id` KHÔNG có GRANT cấp cột. `attacl` của chat_rooms chỉ phủ đúng 11 cột writer do
-- 0540 cấp. Không REVOKE gì ở đây ⇒ bẫy `revoke-table-grant-wipes-column-grants` không áp dụng.
--
-- ⚠️ KHOÁ: `DROP COLUMN` lấy ACCESS EXCLUSIVE trên bảng. Chạy được ở đây vì chat_messages 0 hàng và
-- chat_rooms 23 hàng ⇒ mili-giây. Postgres chỉ đánh dấu `attisdropped`, KHÔNG rewrite heap.
--
-- ĐƯỜNG LUI (dán nguyên văn — dữ liệu không phục hồi được, nhưng cả ba cột vốn 0 hàng):
--   ALTER TABLE chat_messages ADD COLUMN file_name text;
--   ALTER TABLE chat_messages ADD COLUMN file_url  text;
--   ALTER TABLE chat_rooms    ADD COLUMN channel_id uuid;
--   ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_channel_id_fkey
--     FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL;
--   ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_channel_id_company_fk
--     FOREIGN KEY (company_id, channel_id) REFERENCES channels(company_id, id)
--     ON DELETE SET NULL (channel_id);
--   CREATE UNIQUE INDEX chat_rooms_channel_uq ON chat_rooms (company_id, channel_id)
--     WHERE channel_id IS NOT NULL;
-- ⚠️ `ON DELETE SET NULL (channel_id)` — DANH SÁCH CỘT LÀ BẮT BUỘC. Thiếu nó thì Postgres set NULL cả
--    `company_id` khi xoá `channels`, tức tự tay tạo hàng mồ côi không tenant. `fk-tenant-census.ts`
--    có cờ riêng (`coveringSetsNullColumns`) cho đúng bẫy này.
--
-- ĐI KÈM CÙNG COMMIT (nếu không, `db:generate` dựng lại cột ở migration sau):
--   apps/api/src/db/schema/communication.ts · packages/contracts/src/chat.ts · chat.mapper.ts
--   + ratchet điểm danh ở test/integration/s7-chat-db1-invariants.int-spec.ts

-- ═══════════ (A) index unique partial trên (company_id, channel_id) ═══════════
DROP INDEX IF EXISTS chat_rooms_channel_uq;
--> statement-breakpoint

-- ═══════════ (B) composite tenant FK do 0535 tạo (KI-046) ═══════════
ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_channel_id_company_fk;
--> statement-breakpoint

-- ═══════════ (C) FK một-cột di sản mig 0050 ═══════════
ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_channel_id_fkey;
--> statement-breakpoint

-- ═══════════ (D) cột chat_rooms.channel_id ═══════════
ALTER TABLE chat_rooms DROP COLUMN IF EXISTS channel_id;
--> statement-breakpoint

-- ═══════════ (E)(F) hai cột khai tử trên chat_messages ═══════════
ALTER TABLE chat_messages DROP COLUMN IF EXISTS file_url;
--> statement-breakpoint
ALTER TABLE chat_messages DROP COLUMN IF EXISTS file_name;
--> statement-breakpoint

-- ═══════════ VERIFY — chạy trong CÙNG transaction migration, đỏ thì hoàn nguyên sạch ═══════════
DO $$
DECLARE
  v_con  text;
  v_thieu text;
  v_got  text[];
  v_want text[] := ARRAY['archived_at','archived_by','deleted_at','deleted_by','description',
                         'is_archived','last_message_at','last_message_seq','name',
                         'updated_at','updated_by'];
BEGIN
  -- (1) BA CỘT đã biến mất. `information_schema.columns` không thấy cột `attisdropped` ⇒ đúng phép đo.
  SELECT string_agg(c.table_name || '.' || c.column_name, ', ' ORDER BY c.table_name, c.column_name)
    INTO v_con
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND (   (c.table_name = 'chat_rooms'    AND c.column_name = 'channel_id')
          OR (c.table_name = 'chat_messages' AND c.column_name IN ('file_url', 'file_name')));
  IF v_con IS NOT NULL THEN
    RAISE EXCEPTION '[0542] cot khai tu VAN CON: %', v_con;
  END IF;

  -- (2) Ba object (A)(B)(C) đã biến mất cùng cột.
  SELECT string_agg(x.ten, ', ') INTO v_con
    FROM unnest(ARRAY['chat_rooms_channel_uq',
                      'chat_rooms_channel_id_company_fk',
                      'chat_rooms_channel_id_fkey']) AS x(ten)
   WHERE EXISTS (SELECT 1 FROM pg_class i
                  WHERE i.relname = x.ten AND i.relnamespace = 'public'::regnamespace)
      OR EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conname = x.ten AND k.connamespace = 'public'::regnamespace);
  IF v_con IS NOT NULL THEN
    RAISE EXCEPTION '[0542] index/FK cua channel_id VAN CON: %', v_con;
  END IF;

  -- (3) VẾ QUAN TRỌNG HƠN — cái phải GIỮ. `0541` đã chứng minh một tay sửa sau rất dễ "dọn tiếp" nhầm:
  --     `DROP COLUMN` kéo theo MỌI index/constraint có nhắc cột, nên nếu ai đó thêm `channel_id` vào
  --     một index đa cột khác thì cú drop này sẽ nuốt luôn index đó mà không ai biết. Danh sách dưới
  --     là đai chặn: gỡ nhầm một cái là ĐỎ ngay tại migration, không phải ở một spec nạn nhân.
  SELECT string_agg(x.ten, ', ') INTO v_thieu
    FROM unnest(ARRAY[
           'chat_rooms_pkey',
           'chat_rooms_company_id_id_uq',      -- đỡ composite tenant FK trỏ VÀO chat_rooms (KI-046)
           'chat_rooms_project_uq',
           'chat_rooms_org_unit_uq',
           'chat_rooms_direct_uq',
           'uq_chat_rooms_company_code',       -- 0538
           'idx_chat_rooms_company_activity',  -- 0538 — đường đọc danh sách phòng
           'idx_chat_rooms_sync',              -- 0538 — job đối soát phòng dẫn xuất (BE-5)
           'chat_rooms_company_id_idx',
           'chat_rooms_ref_id_idx'
         ]) AS x(ten)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_stat_user_indexes i
            WHERE i.relname = 'chat_rooms' AND i.indexrelname = x.ten);
  IF v_thieu IS NOT NULL THEN
    RAISE EXCEPTION '[0542] THIEU index phai-giu tren chat_rooms: %', v_thieu;
  END IF;

  -- (4) Tập cột UPDATE-được của 0540 trên chat_rooms còn ĐÚNG 11 cột. Bắt trường hợp `DROP COLUMN`
  --     làm xô lệch `attacl` (cấp thừa là đỏ, mất một cột cũng đỏ — pin theo TÊN, không theo count).
  SELECT coalesce(array_agg(a.attname::text ORDER BY a.attname COLLATE "C"), '{}')
    INTO v_got
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname = 'chat_rooms'
     AND acl.grantee = 'mediaos_app'::regrole
     AND acl.privilege_type = 'UPDATE';
  IF v_got <> v_want THEN
    RAISE EXCEPTION '[0542] tap cot UPDATE cua chat_rooms LECH: got=% want=%', v_got, v_want;
  END IF;

  -- (5) RLS còn bật + FORCE trên cả hai bảng (BẤT BIẾN #1). `ALTER TABLE` không tắt RLS, nhưng đây là
  --     migration duy nhất trong wave đụng `ALTER TABLE` trên hai bảng đó — đo còn hơn tin.
  SELECT string_agg(c.relname, ', ') INTO v_con
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('chat_rooms', 'chat_messages')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_con IS NOT NULL THEN
    RAISE EXCEPTION '[0542] RLS/FORCE TAT tren: %', v_con;
  END IF;

  RAISE NOTICE '[0542] OK — go 3 cot khai tu + 1 index + 2 FK; 10 index phai-giu con nguyen, GRANT/RLS khong doi';
END;
$$;
