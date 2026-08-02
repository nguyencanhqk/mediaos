-- S7-CHAT-DB-1 — NỀN DỮ LIỆU CHAT v1: ALTER 3 BẢNG ĐÃ CÓ + TÌM KIẾM TIẾNG VIỆT + SEED QUYỀN/COUNTER/NOTI
--
-- VÌ SAO KHÔNG TẠO BẢNG. Ba bảng `chat_rooms` · `chat_room_members` · `chat_messages` ĐÃ TỒN TẠI THẬT từ
-- mig 0010 (tạo) + 0050 (mở rộng): RLS+FORCE bật, `chat_messages` append-only (app role chỉ SELECT/INSERT
-- + column-GRANT pinned_at/pinned_by), `seq` bigint IDENTITY, `direct_key` dedup DM, composite tenant FK
-- ở 0535. Mig 0050 đã ghi thẳng bài học ở đầu file: "KHÔNG tạo bảng chat_members/messages MỚI — 0010 đã
-- tạo bảng cùng chức năng". Migration này CHỈ ALTER + seed.
--
-- ĐO TIỀN KIỂM TRÊN PROD (`mediaos`, 02/08/2026, chỉ SELECT — plan §2):
--   chat_rooms = 0 · chat_messages = 0 · chat_room_members = 0 · 0 hàng room_type='channel'
--   0 vi phạm anchor (project thiếu ref_id / direct thiếu direct_key / department thiếu org_unit_id)
--   1 company sống · 0 counter 'chat_room' · 0 cặp quyền chat trong catalog
--   (company_id,id) UNIQUE: chat_rooms=CÓ · users=CÓ · chat_messages=KHÔNG · chat_room_members=KHÔNG
-- ⇒ Bảng rỗng nên bước E (rewrite bảng cho cột generated) là MIỄN PHÍ, và mọi backfill chạy 0 hàng.
--   Các câu backfill/đếm dưới đây VẪN GIỮ: chúng là hàng rào cho lane DB và cho môi trường có dữ liệu.
--
-- BẤT BIẾN (CLAUDE.md §2):
--   #1 company_id/RLS: KHÔNG đụng policy hay FORCE RLS — đã có từ 0010. Composite tenant FK bên dưới là
--      LỚP THỨ HAI, xem khối (D).
--   #2 append-only `chat_messages`: KHÔNG GRANT UPDATE cấp bảng, KHÔNG GRANT DELETE. Cột thu hồi mở bằng
--      COLUMN-LEVEL GRANT, đúng cơ chế pinned_at của 0050.
--   #3 không secret: migration này không chạm secret nào.
--
-- MIGRATOR CHẠY BẰNG OWNER (`mediaos`, rolbypassrls — mirror 0498:17-22): seed/backfill không cần set GUC
-- tenant, NHƯNG `company_id` vẫn viết tường minh trong mọi câu (defense-in-depth, và để reviewer FULL gate
-- không phải suy đoán).
--
-- BAND 0538 (lane S7-CHAT-DB-1). Journal: idx 205, when 1717587327000 (> 0537 idx 204 / 1717587326000).
-- Plan: docs/plans/S7-CHAT-DB-1.md (rev 2, sau plan-reviewer BLOCK 5 mục).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ═══════════════ (A) chat_rooms — THÊM CỘT → BACKFILL → RỒI MỚI ADD CONSTRAINT ═══════════════
-- ⚠️ THỨ TỰ LÀ BẮT BUỘC, KHÔNG PHẢI SỞ THÍCH. `sync_source` là cột MỚI DEFAULT 'manual' trong khi
--    chk_chat_rooms_sync_source ép department→'department' và project→'project' ⇒ mọi hàng loại đó
--    đang tồn tại sẽ VI PHẠM NGAY LÚC ADD CONSTRAINT. PROD hiện 0 hàng, nhưng lane DB và môi trường
--    khác thì không chắc — backfill vẫn phải đứng trước.

ALTER TABLE chat_rooms
  ADD COLUMN room_code        varchar(100),
  ADD COLUMN description      text,
  ADD COLUMN sync_source      varchar(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN synced_at        timestamptz,
  ADD COLUMN last_message_at  timestamptz,
  ADD COLUMN last_message_seq bigint,
  ADD COLUMN is_archived      boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at      timestamptz,
  ADD COLUMN archived_by      uuid,
  ADD COLUMN updated_at       timestamptz,
  ADD COLUMN updated_by       uuid,
  ADD COLUMN deleted_at       timestamptz,
  ADD COLUMN deleted_by       uuid;
--> statement-breakpoint

-- BACKFILL sync_source theo room_type (chạy 0 hàng trên PROD, có nghĩa trên DB có dữ liệu)
UPDATE chat_rooms SET sync_source = room_type WHERE room_type IN ('department', 'project');
--> statement-breakpoint

-- room_type: bỏ 'channel' (media out-of-scope sau de-media-fy).
-- Hàng 'channel' còn lại là RÁC CẦN CHUYỂN, không phải lỗi ⇒ NOTICE chứ không EXCEPTION.
-- ⚠️ Tên CHECK phải RESOLVE lúc chạy: 0010 tạo inline (tên auto), 0050:22-32 drop bằng cách quét
--    pg_get_constraintdef. KHÔNG hard-code tên, KHÔNG tự tạo mới nếu không thấy (tránh nuốt CHECK lane khác).
DO $$
DECLARE v_name text; v_moved int;
BEGIN
  UPDATE chat_rooms SET room_type = 'group', sync_source = 'manual' WHERE room_type = 'channel';
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved > 0 THEN
    RAISE NOTICE '[0538] da chuyen % phong room_type=channel sang group (de-media-fy)', v_moved;
  END IF;

  SELECT conname INTO v_name
    FROM pg_constraint
   WHERE conrelid = 'chat_rooms'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%room_type%';

  IF v_name IS NULL THEN
    RAISE EXCEPTION '[0538] khong tim thay CHECK room_type tren chat_rooms — abort (khong tu tao moi)';
  END IF;

  EXECUTE format('ALTER TABLE chat_rooms DROP CONSTRAINT %I', v_name);
  ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_room_type_chk
    CHECK (room_type IN ('direct', 'group', 'department', 'project'));
  RAISE NOTICE '[0538] room_type CHECK: da drop % va add chat_rooms_room_type_chk (bo channel)', v_name;
END;
$$;
--> statement-breakpoint

-- Loại phòng ↔ neo (CHAT-ERR-002) — ĐẾM FAIL-LOUD TRƯỚC. Vi phạm ở đây là dữ liệu hỏng thật,
-- không tự chữa được bằng luật chung ⇒ EXCEPTION kèm số để người vận hành chốt SQL chữa.
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM chat_rooms
   WHERE NOT (
     (room_type = 'direct'     AND direct_key IS NOT NULL AND org_unit_id IS NULL     AND ref_id IS NULL) OR
     (room_type = 'group'      AND direct_key IS NULL     AND org_unit_id IS NULL     AND ref_id IS NULL) OR
     (room_type = 'department' AND direct_key IS NULL     AND org_unit_id IS NOT NULL AND ref_id IS NULL) OR
     (room_type = 'project'    AND direct_key IS NULL     AND org_unit_id IS NULL     AND ref_id IS NOT NULL)
   );
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0538] % phong vi pham loai-phong<->neo — chua SQL truoc khi chay lai (plan §2)', v_bad;
  END IF;
END;
$$;
--> statement-breakpoint

ALTER TABLE chat_rooms ADD CONSTRAINT chk_chat_rooms_type_anchor CHECK (
  (room_type = 'direct'     AND direct_key IS NOT NULL AND org_unit_id IS NULL     AND ref_id IS NULL) OR
  (room_type = 'group'      AND direct_key IS NULL     AND org_unit_id IS NULL     AND ref_id IS NULL) OR
  (room_type = 'department' AND direct_key IS NULL     AND org_unit_id IS NOT NULL AND ref_id IS NULL) OR
  (room_type = 'project'    AND direct_key IS NULL     AND org_unit_id IS NULL     AND ref_id IS NOT NULL)
);
--> statement-breakpoint

ALTER TABLE chat_rooms ADD CONSTRAINT chk_chat_rooms_sync_source CHECK (
  (room_type = 'department'        AND sync_source = 'department') OR
  (room_type = 'project'           AND sync_source = 'project')    OR
  (room_type IN ('direct','group') AND sync_source = 'manual')
);
--> statement-breakpoint

-- name: phòng `direct` không có tên (dựng từ tên 2 người lúc hiển thị) ⇒ DROP NOT NULL,
-- nhưng CHECK vẫn ép NOT NULL cho 3 loại còn lại.
ALTER TABLE chat_rooms ALTER COLUMN name DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE chat_rooms ADD CONSTRAINT chk_chat_rooms_name
  CHECK (room_type = 'direct' OR name IS NOT NULL);
--> statement-breakpoint

-- ═══════════════ (B) room_code: COUNTER → BACKFILL → SYNC → NOT NULL (MỘT KHỐI, ĐÚNG THỨ TỰ) ═══════════════
-- ⚠️ Mẫu 0498 là BỘ BA NGUYÊN KHỐI, bỏ bước nào cũng vỡ. Bỏ bước SYNC là bẫy chết người:
--    ON CONFLICT DO NOTHING để counter ở current_value = 0 ⇒ phòng đầu tiên tạo qua API gọi
--    SequenceService.nextCode → sinh ROOM-0001 → ĐỤNG CHÍNH MÃ VỪA BACKFILL → 23505 trên
--    uq_chat_rooms_company_code, và chạy lại migration KHÔNG cứu được. Đúng họ bug QA2-CRIT-002 của task_code.
--
-- CONTRACT khoá cho S7-CHAT-BE-1 — LITERAL, không được đổi ở WO sau:
--   sequence_key='chat_room' · scope_type='Company' · module_code='CHAT'
--   reset_policy='Never'     · prefix='ROOM-'       · padding_length=4
INSERT INTO sequence_counters (
  company_id, module_code, sequence_key, scope_type,
  prefix, padding_length, reset_policy, increment_by, current_value, status
)
SELECT c.id, 'CHAT', 'chat_room', 'Company',
       'ROOM-', 4, 'Never', 1, 0, 'Active'
  FROM companies c
 WHERE c.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DO $$
DECLARE r record; v_n int; v_last text;
BEGIN
  -- (2) backfill room_code, đánh số tiếp TỪ current_value của từng company
  FOR r IN SELECT id AS company_id FROM companies WHERE deleted_at IS NULL LOOP
    SELECT current_value INTO v_n
      FROM sequence_counters
     WHERE company_id = r.company_id AND sequence_key = 'chat_room' AND deleted_at IS NULL;

    IF v_n IS NULL THEN
      RAISE EXCEPTION '[0538] company % thieu counter chat_room sau seed', r.company_id;
    END IF;

    WITH numbered AS (
      SELECT id, v_n + row_number() OVER (ORDER BY created_at, id) AS n
        FROM chat_rooms
       WHERE company_id = r.company_id AND room_code IS NULL
    )
    UPDATE chat_rooms cr
       SET room_code = 'ROOM-' || lpad(numbered.n::text, 4, '0')
      FROM numbered
     WHERE cr.id = numbered.id AND cr.company_id = r.company_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- (3) SYNC current_value + last_generated_code — BẮT BUỘC, xem ghi chú đầu khối
    IF v_n > 0 THEN
      SELECT max(room_code) INTO v_last
        FROM chat_rooms WHERE company_id = r.company_id AND room_code IS NOT NULL;

      UPDATE sequence_counters sc
         SET current_value       = GREATEST(sc.current_value,
                                     (SELECT count(*) FROM chat_rooms
                                       WHERE company_id = r.company_id AND room_code IS NOT NULL)),
             last_generated_code = v_last
       WHERE sc.company_id = r.company_id AND sc.sequence_key = 'chat_room' AND sc.deleted_at IS NULL;

      RAISE NOTICE '[0538] company %: backfill % room_code, sync counter -> %', r.company_id, v_n, v_last;
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

ALTER TABLE chat_rooms ALTER COLUMN room_code SET NOT NULL;
--> statement-breakpoint

-- Index chat_rooms (theo DB-12 §6.1, GIỮ NGUYÊN vị từ — index không vị từ sẽ quét cả hàng đã xoá mềm)
CREATE UNIQUE INDEX uq_chat_rooms_company_code ON chat_rooms (company_id, room_code)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_chat_rooms_active ON chat_rooms (company_id, last_message_at DESC)
  WHERE deleted_at IS NULL AND is_archived = false;
--> statement-breakpoint
-- Job đối soát đêm chỉ quét phòng DẪN XUẤT (DB-12 §8) — vị từ sync_source <> 'manual' là chủ ý.
CREATE INDEX idx_chat_rooms_sync ON chat_rooms (company_id, sync_source)
  WHERE deleted_at IS NULL AND sync_source <> 'manual';
--> statement-breakpoint

-- ═══════════════ (C) chat_room_members ═══════════════
ALTER TABLE chat_room_members
  ADD COLUMN last_read_seq    bigint NOT NULL DEFAULT 0,
  ADD COLUMN muted_until      timestamptz,
  ADD COLUMN left_at          timestamptz,
  ADD COLUMN visible_from_seq bigint,
  ADD COLUMN added_by         uuid,
  ADD CONSTRAINT chk_chat_members_read_seq CHECK (last_read_seq >= 0);
--> statement-breakpoint

-- visible_from_seq LUÔN NULL ở v1 (CHAT-DEC-008: thành viên mới đọc TOÀN BỘ lịch sử). Cột chừa sẵn để
-- phase sau bật "chỉ đọc từ lúc vào" mà không phải migration đổi hình dạng bảng. NULL chứ không phải 0 —
-- mọi vị từ đọc viết `(m.visible_from_seq IS NULL OR msg.seq >= m.visible_from_seq)` ngay từ v1.

CREATE INDEX idx_chat_members_user_active ON chat_room_members (company_id, user_id)
  WHERE left_at IS NULL;
--> statement-breakpoint

-- GIỮ unique (room_id, user_id) đã có từ 0010: rời phòng = SET left_at, KHÔNG DELETE hàng.
-- ⚠️ Hệ quả cho S7-CHAT-BE-1: người rời rồi vào lại phòng nhóm TÁI DÙNG đúng hàng cũ
--    (left_at = NULL, cập nhật joined_at) — insert hàng thứ hai sẽ dính 23505.
GRANT UPDATE (last_read_seq, muted_until, left_at, visible_from_seq) ON chat_room_members TO mediaos_app;
--> statement-breakpoint

-- REVOKE DELETE: ngữ nghĩa "rời phòng = left_at" và "phòng = soft delete" cho tới giờ KHÔNG có gì ép ở
-- tầng DB (0010:72,103 cấp DELETE cấp bảng). Code chat cũ đã bị git rm ở 2591db13 ⇒ 0 caller sống, đây là
-- CỬA SỔ RẺ NHẤT để đóng. Sau khi BE-1 ship thì revoke phải đi expand-contract 2 release.
REVOKE DELETE ON chat_room_members FROM mediaos_app;
--> statement-breakpoint
REVOKE DELETE ON chat_rooms FROM mediaos_app;
--> statement-breakpoint

-- ═══════════════ (D) chat_messages — VÙNG APPEND-ONLY + COMPOSITE TENANT FK ═══════════════
-- ⚠️ MỌI FK MỚI PHẢI LÀ COMPOSITE. Kiểm tra FK của Postgres BỎ QUA RLS theo thiết kế, nên FK MỘT CỘT nối
--    hai bảng đều có company_id cho phép ngữ cảnh tenant A ghi hàng của mình trỏ sang bản ghi của B —
--    đúng lớp lỗ KI-046 mà 0535 vừa đóng. Và `xtenant-fk-ratchet.int-spec.ts` gate `hasDb` (KHÔNG gate
--    LANE_DB) ⇒ chạy THẬT trên CI, thêm FK một cột là ĐỎ ngay.
--    Bắt buộc dạng ON DELETE SET NULL (<col>) CÓ DANH SÁCH CỘT — SET NULL trần sẽ null luôn company_id
--    (ratchet ca (f); 0535:681-682).

-- chat_messages CHƯA có (company_id,id) UNIQUE (đo 02/08: chat_rooms=CÓ, chat_messages=KHÔNG)
-- ⇒ phải thêm để làm ĐÍCH cho FK tự tham chiếu reply_to_message_id.
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint

ALTER TABLE chat_messages
  ADD COLUMN client_message_id   uuid,
  ADD COLUMN reply_to_message_id uuid,
  ADD COLUMN recalled_at         timestamptz,
  ADD COLUMN recalled_by         uuid,
  ADD COLUMN attachment_count    smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_chat_messages_attachment_count CHECK (attachment_count >= 0);
--> statement-breakpoint

-- message_type += 'system' (tin do server sinh: thêm/bớt thành viên, đổi tên phòng).
-- Tên CHECK resolve lúc chạy — 0050:71 tạo inline nên tên là auto.
DO $$
DECLARE v_name text;
BEGIN
  SELECT conname INTO v_name
    FROM pg_constraint
   WHERE conrelid = 'chat_messages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%message_type%';

  IF v_name IS NULL THEN
    RAISE EXCEPTION '[0538] khong tim thay CHECK message_type tren chat_messages — abort';
  END IF;

  EXECUTE format('ALTER TABLE chat_messages DROP CONSTRAINT %I', v_name);
  ALTER TABLE chat_messages ADD CONSTRAINT chk_chat_messages_type
    CHECK (message_type IN ('text', 'file', 'system'));
  RAISE NOTICE '[0538] message_type CHECK: da drop % va add chk_chat_messages_type (them system)', v_name;
END;
$$;
--> statement-breakpoint

-- Composite tenant FK — 6 cột FK mới, KHÔNG cái nào được để một cột (xem cảnh báo đầu khối D)
ALTER TABLE chat_rooms
  ADD CONSTRAINT chat_rooms_archived_by_tenant_fk FOREIGN KEY (company_id, archived_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (archived_by),
  ADD CONSTRAINT chat_rooms_updated_by_tenant_fk  FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT chat_rooms_deleted_by_tenant_fk  FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint

ALTER TABLE chat_room_members
  ADD CONSTRAINT chat_room_members_added_by_tenant_fk FOREIGN KEY (company_id, added_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (added_by);
--> statement-breakpoint

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_recalled_by_tenant_fk FOREIGN KEY (company_id, recalled_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (recalled_by),
  ADD CONSTRAINT chat_messages_reply_to_tenant_fk    FOREIGN KEY (company_id, reply_to_message_id)
    REFERENCES chat_messages (company_id, id) ON DELETE SET NULL (reply_to_message_id);
--> statement-breakpoint

-- Idempotent gửi lại (CHAT-ERR-014): trùng (company, phòng, người gửi, clientMessageId) → trả bản ghi cũ
CREATE UNIQUE INDEX uq_chat_messages_client_id
  ON chat_messages (company_id, room_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_chat_messages_room_seq ON chat_messages (company_id, room_id, seq DESC);
--> statement-breakpoint
CREATE INDEX idx_chat_messages_reply ON chat_messages (company_id, reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
--> statement-breakpoint

-- COLUMN-LEVEL GRANT: CHỈ 2 cột thu hồi. 0050 đã cấp (pinned_at, pinned_by).
-- TUYỆT ĐỐI KHÔNG GRANT UPDATE cấp bảng, KHÔNG GRANT DELETE — body/sender_id/seq bất biến (BẤT BIẾN #2).
-- ⚠️ attachment_count CỐ Ý KHÔNG có trong GRANT: nó phải được đặt NGAY TRONG CÂU INSERT tin nhắn
--    (= fileIds.length, biết từ SPEC-15 §13.5). DB-12 bản 01/08 viết "cập nhật cùng transaction ⇒ không
--    cần GRANT UPDATE" là SAI — quyền Postgres không đến từ việc nằm cùng transaction, nên mọi
--    UPDATE ... SET attachment_count sẽ bị từ chối và MỌI TIN CÓ TỆP TRẢ 500. Ràng buộc này đã chép sang
--    done_when của S7-CHAT-BE-3.
GRANT UPDATE (recalled_at, recalled_by) ON chat_messages TO mediaos_app;
--> statement-breakpoint

-- ═══════════════ (E) TÌM KIẾM TIẾNG VIỆT (có dấu / không dấu) ═══════════════
-- ⚠️ f_unaccent PHẢI IMMUTABLE: unaccent() gốc chỉ STABLE nên dùng thẳng trong cột generated là
--    migration ĐỎ. Cast ::regdictionary tường minh + qualify public. triệt để — cột generated NEO VÀO
--    OID HÀM, sai search_path lúc migrate là hỏng VĨNH VIỄN (phải rewrite bảng để sửa).
--    Dùng cấu hình 'simple', KHÔNG 'english' — tiếng Việt không có stemmer tiếng Anh.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
--> statement-breakpoint

-- Bước này REWRITE BẢNG. PROD đo 0 hàng chat_messages (02/08) ⇒ miễn phí.
ALTER TABLE chat_messages ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', public.f_unaccent(coalesce(body, '')))) STORED;
--> statement-breakpoint

CREATE INDEX idx_chat_messages_search ON chat_messages USING GIN (search_vector);
--> statement-breakpoint

-- ═══════════════ (F) SEED 10 CẶP QUYỀN (module CHAT đã có sẵn, CỐ Ý CHƯA BẬT) ═══════════════
-- ⚠️ KHÔNG INSERT và KHÔNG BẬT module. Hàng `modules.CHAT` ĐÃ TỒN TẠI từ mig 0435 (catalog module
--    foundation) với module_group='Extension', sort_order=12, is_active=FALSE — placeholder cho module
--    chưa launch. Đo trên PROD 02/08: đúng như vậy.
--
--    Bản nháp của migration này TỪNG bật `is_active=true` và làm ĐỎ pin
--    `migration-smoke.int-spec.ts` › "2b. Modules catalog — Extension inactive" ("Module Extension 'CHAT'
--    phải is_active=false (chưa launch)"). Pin đó ĐÚNG và giữ nguyên: bật module ở tầng DB khi CHƯA có
--    endpoint/màn hình nào là hứa suông với người dùng — đúng lớp lỗi `ui-promises-backend-never-reads`.
--    Việc bật cờ thuộc WO CUỐI của wave (sau khi FE-3 xong), không phải WO nền dữ liệu này.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'CHAT' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0538] modules.CHAT khong ton tai (ky vong 1 hang tu mig 0435, dem duoc %)', v_n;
  END IF;
  RAISE NOTICE '[0538] modules.CHAT ton tai, GIU is_active=false (chua launch — WO cuoi wave moi bat)';
END;
$$;
--> statement-breakpoint

-- 9 cặp thường (is_sensitive=false) + cặp thứ 10 đọc-vượt (is_sensitive=TRUE).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('access',  'chat',            false),
  ('view',    'chat-room',       false),
  ('create',  'chat-room',       false),
  ('update',  'chat-room',       false),
  ('archive', 'chat-room',       false),
  ('manage',  'chat-member',     false),
  ('send',    'chat-message',    false),
  ('recall',  'chat-message',    false),
  ('pin',     'chat-message',    false),
  -- CHAT-DEC-004 (owner chốt 02/08/2026, NGƯỢC đề xuất Draft): Super Admin đọc được mọi phòng, có audit.
  -- Đóng khung bằng CẶP RIÊNG này — KHÔNG nới scope của ('view','chat-room'), để đường đọc thường giữ
  -- được tính chất "gọi assertMember vô điều kiện" (SPEC-15 §3.3 · API-13 §5.3 ràng buộc 1).
  ('view',    'chat-oversight',  true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant per-pair cho 4 role canonical — CHỈ 9 cặp thường.
-- Ma trận (plan §3F): 9 cặp × 4 role, tất cả data_scope='Company' ⇒ N = 36 hàng.
--   • 'all' của SPEC-15 §11 KHÔNG phải giá trị data_scope hợp lệ (chỉ Own/Team/Department/Company/System)
--     ⇒ ánh xạ 'all' → 'Company'. 'System' dành cho platform/SA.
--   • SPEC-15 §11 KHÔNG có cột 'hr' ⇒ QUYẾT ĐỊNH của plan: hr nhận đúng như employee. CHAT là công cụ
--     phổ quát, HR không có đặc quyền chat nào.
--   • Đồng nhất là ĐÚNG chứ không phải lười: quyền chỉ là CỔNG MODULE, ranh giới thật do
--     ChatAccessService.assertMember ép ở service; "admin phòng" là chat_room_members.role='admin',
--     KHÔNG phải role hệ thống.
-- Resolve role THEO THUỘC TÍNH (name + company_id IS NULL + deleted_at IS NULL) — mirror 0506:96,
-- KHÔNG hard-code id. DELETE-wrong-scope + INSERT ON CONFLICT (idempotent, chống drift scope).
DO $$
DECLARE
  r         record;
  v_role_id uuid;
  v_perm_id uuid;
  v_role    text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['employee', 'manager', 'hr', 'company-admin'] LOOP
    SELECT id INTO v_role_id FROM roles
     WHERE name = v_role AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0538] role canonical % khong ton tai — seed 0005/0444 phai chay truoc', v_role;
    END IF;

    FOR r IN
      SELECT * FROM (VALUES
        ('access',  'chat'),
        ('view',    'chat-room'),
        ('create',  'chat-room'),
        ('update',  'chat-room'),
        ('archive', 'chat-room'),
        ('manage',  'chat-member'),
        ('send',    'chat-message'),
        ('recall',  'chat-message'),
        ('pin',     'chat-message')
      ) AS p(act, res)
    LOOP
      SELECT id INTO v_perm_id FROM permissions
       WHERE action = r.act AND resource_type = r.res;
      IF v_perm_id IS NULL THEN
        RAISE EXCEPTION '[0538] permission (%:%) khong co trong catalog — khoi seed phai chay truoc',
          r.act, r.res;
      END IF;

      -- DELETE-wrong-scope + INSERT ON CONFLICT: idempotent, và chống drift scope nếu chạy lại
      DELETE FROM role_permissions
       WHERE role_id = v_role_id AND permission_id = v_perm_id AND data_scope <> 'Company';

      INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
      VALUES (v_role_id, v_perm_id, 'ALLOW', 'Company')
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ⚠️ ('view','chat-oversight') KHÔNG grant cho role canonical nào — CÓ CHỦ Ý, không phải bỏ sót.
--    `super-admin` KHÔNG PHẢI role canonical: 4 role canonical là roles.company_id IS NULL
--    (employee/manager/hr/company-admin), SA là role COMPANY-SCOPED dựng lúc boot bởi
--    SuperAdminBootstrapService — vòng lặp đó grant TOÀN BỘ catalog (trừ reveal-secret:platform-account)
--    ⇒ cặp mới TỰ ĐỘNG vào SA. Viết INSERT ... WHERE code='super-admin' ở đây khớp 0 HÀNG, verify
--    "SA có cặp" LUÔN ĐỎ, và lối thoát rẻ nhất của người thi công là grant lạc sang company-admin —
--    đúng role SPEC-15 §11 CẤM. Khẳng định "SA có cặp" là int-spec chạy SAU BOOT, không phải ở đây.
--    Chốt vĩnh viễn: cặp này nằm trong FORBIDDEN_PAIRS của auth-seed-canonical-roles.int-spec.ts.

-- ═══════════════ (G) SEED counter đã làm ở (B) · NOTI catalog + nới CHECK 2 BẢNG ═══════════════
-- ⚠️ CHECK catalog NOTI nằm ở HAI bảng. 0507 (GOAL) nới trên notification_events nhưng QUÊN
--    notification_types/module_code trên `notifications` ⇒ MỌI thông báo GOAL vỡ khi INSERT; phải vá ở
--    0529. Không lặp lại: khối dưới nới trên CẢ HAI.
--    Dùng mẫu 0507/0529 (guard LIKE + re-stamp superset tường minh), KHÔNG dùng parser DO-block 0474
--    (giả định array-literal '{...}', trả NULL với dạng `= ANY(ARRAY[...]::text[])` ⇒ SILENT SKIP).
--    ĐO THẬT 02/08 trên `mediaos`: cả 4 constraint ở dạng `= ANY ((ARRAY[...]::varchar[])::text[])`
--    — KHÔNG phải dạng `IN (...)`. Vì vậy KHÔNG vá bằng regex trên constraintdef.

-- CHỐT TIỀN ĐỀ: re-stamp bên dưới VIẾT TAY tập giá trị cũ, nên nếu baseline khác giả định thì ta sẽ
-- ÂM THẦM XOÁ giá trị của lane khác. Chặn trước: 4 constraint phải đang ở đúng baseline 0529 (có LMS +
-- Training). Lệch ⇒ dừng, đọc lại def thật rồi cập nhật superset.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(conname, ', ') INTO v_bad
    FROM pg_constraint
   WHERE conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
     AND pg_get_constraintdef(oid) NOT LIKE '%''LMS''%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0538] baseline lech: % chua co LMS — superset viet tay se xoa gia tri lane khac', v_bad;
  END IF;

  SELECT string_agg(conname, ', ') INTO v_bad
    FROM pg_constraint
   WHERE conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
     AND pg_get_constraintdef(oid) NOT LIKE '%''Training''%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0538] baseline lech: % chua co Training — superset viet tay se xoa gia tri lane khac', v_bad;
  END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname  = 'chk_notification_events_module_code'
       AND pg_get_constraintdef(oid) LIKE '%''CHAT''%'
  ) THEN
    RAISE NOTICE '[0538] CHAT da co trong chk_notification_events_module_code — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_module_code;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_module_code
      CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT'));
    RAISE NOTICE '[0538] da them CHAT vao chk_notification_events_module_code';
  END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname  = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Chat''%'
  ) THEN
    RAISE NOTICE '[0538] Chat da co trong chk_notification_events_type — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_type;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_type
      CHECK (notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project',
                                   'Approval','Reminder','Warning','Error','Goal','Training','Chat'));
    RAISE NOTICE '[0538] da them Chat vao chk_notification_events_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- Vế `notifications` — CHÍNH LÀ VẾ 0507 BỎ SÓT (phải vá ở 0529). GIỮ nhánh `IS NULL OR`: hàng legacy để
-- 2 cột này NULL (0479:249), bỏ nhánh đó là làm ĐỎ toàn bộ notification cũ.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname  = 'chk_notifications_module_code'
       AND pg_get_constraintdef(oid) LIKE '%''CHAT''%'
  ) THEN
    RAISE NOTICE '[0538] CHAT da co trong chk_notifications_module_code — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_module_code;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_module_code
      CHECK (module_code IS NULL OR module_code IN
             ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT'));
    RAISE NOTICE '[0538] da them CHAT vao chk_notifications_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname  = 'chk_notifications_notification_type'
       AND pg_get_constraintdef(oid) LIKE '%''Chat''%'
  ) THEN
    RAISE NOTICE '[0538] Chat da co trong chk_notifications_notification_type — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_notification_type;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_notification_type
      CHECK (notification_type IS NULL OR notification_type IN
             ('System','Account','HR','Attendance','Leave','Task','Project',
              'Approval','Reminder','Warning','Error','Goal','Training','Chat'));
    RAISE NOTICE '[0538] da them Chat vao chk_notifications_notification_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- Catalog 2 event CHAT. dedupe_strategy CHỐT Ở ĐÂY (mặc định 0479 là 'None'):
--   CHAT_DIRECT_MESSAGE = 'DedupeKey' — S7-CHAT-BE-6 gộp lô 15 phút bằng
--     dedupeKey 'chat:{roomId}:{recipientUserId}:{bucket15m}'; để 'None' thì BE-6 phải sửa seed
--     = MIGRATION THỨ HAI.
--   CHAT_MENTIONED = 'None' — gửi ngay, không gộp.
-- ON CONFLICT nhắm PARTIAL unique (uq_notification_events_global_code_active) — bare ON CONFLICT nổ 42P10.
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority,
   default_channels, is_enabled, is_system_event, dedupe_strategy)
VALUES
  (NULL::uuid, 'CHAT', 'CHAT_MENTIONED',      'Được nhắc tên trong chat', 'Chat', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'None'),
  (NULL::uuid, 'CHAT', 'CHAT_DIRECT_MESSAGE', 'Tin nhắn riêng mới',       'Chat', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey')
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- Template GLOBAL IN_APP/vi-VN (mirror 0529:147-186 — SELECT từ VALUES để lấy event_id).
-- ⚠️ BẤT BIẾN #3 + SPEC-15 §17 + CHAT-DEC-011: template KHÔNG chứa NỘI DUNG TIN NHẮN — chỉ tên người
--    gửi / tên phòng / số đếm. Notification có nhiều người đọc hơn phòng chat.
--    target_url là route NỘI BỘ (assertInternalTargetUrl chặn URL ngoài → 422).
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template,
   short_body_template, target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template,
  t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('CHAT_MENTIONED', 'CHAT_MENTIONED__IN_APP__vi-VN',
     '{actor_name} đã nhắc tên bạn',
     '{actor_name} đã nhắc tên bạn trong phòng {room_name}.',
     '{actor_name} nhắc tên bạn',
     '/chat/{room_id}',
     '{"actor_name":"string","room_name":"string","room_id":"uuid"}'),
  ('CHAT_DIRECT_MESSAGE', 'CHAT_DIRECT_MESSAGE__IN_APP__vi-VN',
     'Tin nhắn mới từ {actor_name}',
     'Bạn có {unread_count} tin nhắn chưa đọc từ {actor_name}.',
     '{unread_count} tin nhắn mới',
     '/chat/{room_id}',
     '{"actor_name":"string","unread_count":"number","room_id":"uuid"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template,
       target_url_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code AND e.company_id IS NULL AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ═══════════════ (H) VERIFY FAIL-LOUD — mirror 0506:197-276 ═══════════════
-- Liệt kê TƯỜNG MINH 10 cặp, KHÔNG dùng LIKE 'chat%' (sẽ nuốt cặp chat-report tương lai).
DO $$
DECLARE v_n int; v_sens bool;
BEGIN
  -- (1) catalog đủ 10 cặp
  SELECT count(*) INTO v_n FROM permissions
   WHERE (action, resource_type) IN (
     ('access','chat'), ('view','chat-room'), ('create','chat-room'), ('update','chat-room'),
     ('archive','chat-room'), ('manage','chat-member'), ('send','chat-message'),
     ('recall','chat-message'), ('pin','chat-message'), ('view','chat-oversight'));
  IF v_n <> 10 THEN
    RAISE EXCEPTION '[0538] verify: catalog co % cap chat, ky vong 10 — khoi seed permissions truot', v_n;
  END IF;

  -- (2) grant canonical đúng 36 hàng (9 cặp × 4 role, scope Company). Over/under đều đỏ.
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    JOIN roles r       ON r.id = rp.role_id
   WHERE (p.action, p.resource_type) IN (
           ('access','chat'), ('view','chat-room'), ('create','chat-room'), ('update','chat-room'),
           ('archive','chat-room'), ('manage','chat-member'), ('send','chat-message'),
           ('recall','chat-message'), ('pin','chat-message'))
     AND r.company_id IS NULL AND r.deleted_at IS NULL;
  IF v_n <> 36 THEN
    RAISE EXCEPTION '[0538] verify: % grant chat cho role canonical, ky vong 36 — over/under-grant (drift?)', v_n;
  END IF;

  -- (3) VẾ ÂM: 0 role canonical giữ ('view','chat-oversight') — vế duy nhất verify được ở tầng migration
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    JOIN roles r       ON r.id = rp.role_id
   WHERE p.action = 'view' AND p.resource_type = 'chat-oversight'
     AND r.company_id IS NULL AND r.deleted_at IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0538] verify: % role canonical GIU (view,chat-oversight) — vo CHAT-DEC-004 (chi SA duoc doc-vuot)', v_n;
  END IF;

  -- (4) VẾ DƯƠNG đi kèm (3): không có vế này thì "0" ở trên có thể chỉ vì seed trượt
  SELECT is_sensitive INTO v_sens FROM permissions
   WHERE action = 'view' AND resource_type = 'chat-oversight';
  IF v_sens IS NULL THEN
    RAISE EXCEPTION '[0538] verify: cap (view,chat-oversight) KHONG co trong catalog — verify (3) vo nghia';
  ELSIF v_sens IS NOT TRUE THEN
    RAISE EXCEPTION '[0538] verify: (view,chat-oversight) is_sensitive=% , ky vong TRUE', v_sens;
  END IF;

  -- (5) 9 cặp thường phải is_sensitive=false (flip sau seed làm ĐỎ pin auth-seed-canonical-roles)
  SELECT count(*) INTO v_n FROM permissions
   WHERE (action, resource_type) IN (
           ('access','chat'), ('view','chat-room'), ('create','chat-room'), ('update','chat-room'),
           ('archive','chat-room'), ('manage','chat-member'), ('send','chat-message'),
           ('recall','chat-message'), ('pin','chat-message'))
     AND is_sensitive IS DISTINCT FROM false;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0538] verify: % cap chat thuong co is_sensitive <> false', v_n;
  END IF;

  -- (6) counter cho MỌI company (thiếu = SequenceNotFoundError ngay phòng đầu tiên — bug QA2-CRIT-002)
  SELECT count(*) INTO v_n
    FROM companies c
   WHERE c.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM sequence_counters sc
                      WHERE sc.company_id = c.id AND sc.sequence_key = 'chat_room' AND sc.deleted_at IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0538] verify: % company thieu counter chat_room — phong dau tien se 404', v_n;
  END IF;

  -- (7) audit_logs.object_type: CHỈ VERIFY (0050 đã UNION-ADD) — KHÔNG thêm lại.
  -- ⚠️ Constraint này ở dạng ARRAY-LITERAL `object_type = ANY ('{a,b,c}'::text[])`, KHÔNG phải dạng
  --    `ARRAY['a'::varchar,...]` như 4 constraint NOTI. Vì vậy LIKE '%''chat_room''%' KHÔNG BAO GIỜ khớp
  --    (không có dấu nháy quanh từng phần tử) ⇒ sẽ báo THIẾU trong khi giá trị CÓ THẬT — đúng họ bẫy
  --    `audit-check-union-parse-anchor-trap`. Phải tách mảng rồi so khớp PHẦN TỬ, không so chuỗi con
  --    (so chuỗi con cũng sai chiều ngược lại: 'chat_room' là chuỗi con của 'chat_rooms' nếu sau này có).
  DECLARE v_types text[];
  BEGIN
    SELECT string_to_array(substring(pg_get_constraintdef(oid) from '\{(.*?)\}'), ',')
      INTO v_types
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND conname = 'audit_logs_object_type_chk';

    IF v_types IS NULL THEN
      RAISE EXCEPTION '[0538] verify: khong doc duoc audit_logs_object_type_chk (doi dang dinh nghia?)';
    ELSIF NOT ('chat_room' = ANY (v_types) AND 'chat_message' = ANY (v_types)) THEN
      RAISE EXCEPTION '[0538] verify: audit_logs_object_type_chk THIEU chat_room/chat_message (0050 phai co san)';
    END IF;
  END;

  -- (8) module CHAT tồn tại và CỐ Ý CHƯA BẬT (pin migration-smoke "Extension inactive" — xem khối F)
  SELECT count(*) INTO v_n FROM modules
   WHERE module_code = 'CHAT' AND deleted_at IS NULL AND is_active = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0538] verify: modules.CHAT phai ton tai voi is_active=false (WO cuoi wave moi bat)';
  END IF;

  -- (9) 2 event NOTI enabled (bridge fail-loud lúc BOOT nếu eventCode chưa isEnabled=true ⇒ API sập)
  SELECT count(*) INTO v_n FROM notification_events
   WHERE event_code IN ('CHAT_MENTIONED', 'CHAT_DIRECT_MESSAGE')
     AND company_id IS NULL AND deleted_at IS NULL AND is_enabled;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '[0538] verify: % event CHAT enabled, ky vong 2 — OutboxNotificationBridge se sap luc boot', v_n;
  END IF;

  RAISE NOTICE '[0538] VERIFY OK: 10 cap · 36 grant canonical · 0 grant oversight · counter du · NOTI 2 event';
END;
$$;
--> statement-breakpoint

-- ═══════════════ ĐƯỜNG LÙI (không chạy — để trong comment, mirror 0506:285) ═══════════════
-- Migration này THUẦN ALTER + seed, KHÔNG xoá dữ liệu nghiệp vụ nào. Lùi bằng migration NGHỊCH ĐẢO
-- (KHÔNG `git revert` — DB đã đổi hình dạng):
--   DROP INDEX idx_chat_messages_search, idx_chat_messages_reply, idx_chat_messages_room_seq,
--              uq_chat_messages_client_id, idx_chat_members_user_active,
--              idx_chat_rooms_sync, idx_chat_rooms_active, uq_chat_rooms_company_code;
--   ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_reply_to_tenant_fk, ... ;
--   ALTER TABLE chat_messages DROP COLUMN search_vector, attachment_count, recalled_by, recalled_at,
--                                         reply_to_message_id, client_message_id;
--   DROP FUNCTION public.f_unaccent(text);
--   ALTER TABLE chat_room_members DROP COLUMN added_by, visible_from_seq, left_at, muted_until, last_read_seq;
--   ALTER TABLE chat_rooms DROP COLUMN deleted_by, ... room_code;
--   DELETE FROM role_permissions rp USING permissions p WHERE rp.permission_id = p.id
--     AND p.resource_type IN ('chat','chat-room','chat-member','chat-message','chat-oversight');
--   UPDATE sequence_counters SET deleted_at = now() WHERE sequence_key = 'chat_room';
-- ⚠️ HAI THỨ KHÔNG LÙI SẠCH:
--   (a) Bước (E) đã REWRITE BẢNG một lần; lùi là rewrite lần nữa.
--   (b) REVOKE/GRANT: sau khi S7-CHAT-BE-1 ship, revoke column-GRANT = CỬA SỔ 403 ⇒ phải đi
--       expand-contract 2 release (memory `migration-expand-contract-required`).
