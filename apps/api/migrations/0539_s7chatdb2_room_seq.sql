-- S7-CHAT-DB-2 — `chat_messages.room_seq`: SỐ THỨ TỰ PER-ROOM
--
-- VÌ SAO. Mig 0050:77 khai `ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY` — identity CẤP BẢNG,
-- tăng đơn điệu xuyên MỌI phòng và MỌI tenant. Nhưng comment ngay dòng dưới (0050:79) viết "seq = thứ tự
-- tổng ổn định trong room", và SPEC-15 §13.2 xây công thức đếm chưa đọc lên câu đó:
--     unread = last_message_seq − last_read_seq
-- Công thức đó đếm TỔNG SỐ TIN TOÀN HỆ THỐNG chèn giữa hai mốc, không phải số tin chưa đọc của phòng.
--
-- ĐO THẬT (lane, rollback, 02/08/2026): phòng A 1 tin → đọc hết → phòng B (KHÔNG liên quan) 50 tin →
-- phòng A thêm ĐÚNG 1 tin. `last_message_seq` của A = 52, `last_read_seq` = 1 ⇒ badge hiện **51**,
-- đúng phải là **1**. Lệch đúng bằng số tin của phòng khác.
--
-- VẾ THỨ HAI, NẶNG HƠN CON SỐ SAI: `seq` là con trỏ phân trang LỘ RA CLIENT (`beforeSeq`/`afterSeq`,
-- API-13 §5.1). Với seq toàn cục, thành viên MỘT phòng nhìn seq nhảy bao nhiêu là suy ra được lưu lượng
-- tin toàn công ty giữa hai lần mình nhắn — GỒM CẢ DM họ không thuộc. Trong module mà toàn bộ giá trị
-- nằm ở ranh giới membership (SPEC-15 §3.2), đó là rò khối lượng thật.
--
-- VÌ SAO LÀM BÂY GIỜ. `chat_messages` đang **0 hàng trên PROD** (đo 02/08) ⇒ thêm cột + backfill +
-- SET NOT NULL gần như miễn phí. Đợi có dữ liệu thì backfill đắt VÀ đổi ngữ nghĩa con trỏ là breaking
-- change với FE. Owner chốt 02/08.
--
-- BẤT BIẾN: KHÔNG đụng RLS/FORCE · KHÔNG GRANT UPDATE cấp bảng hay DELETE trên chat_messages (bất biến
-- #2 — `room_seq` gán LÚC INSERT, không sửa về sau) · KHÔNG bỏ cột `seq` (identity không drop được sạch
-- và index 0050 còn dùng) — chỉ NGỪNG LỘ nó ra client.
--
-- BAND 0539 (lane S7-CHAT-DB-2). Journal: idx 206, when 1717587328000 (> 0538 idx 205 / 1717587327000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE chat_messages ADD COLUMN room_seq bigint;
--> statement-breakpoint

-- Backfill: đánh số lại LIÊN TỤC TỪ 1 trong từng phòng, theo đúng thứ tự `seq` cũ (seq toàn cục vẫn là
-- thứ tự ĐÚNG bên trong một phòng — nó chỉ sai khi đem TRỪ). Chạy 0 hàng trên PROD; giữ cho lane/môi
-- trường có dữ liệu.
UPDATE chat_messages m
   SET room_seq = x.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY company_id, room_id ORDER BY seq) AS rn
      FROM chat_messages
  ) x
 WHERE m.id = x.id;
--> statement-breakpoint

ALTER TABLE chat_messages ALTER COLUMN room_seq SET NOT NULL;
--> statement-breakpoint

-- ĐAI THỨ HAI. Cơ chế cấp số là khoá hàng `chat_rooms` (UPDATE ... RETURNING) nên đã tuần tự hoá theo
-- phòng; unique này bắt trường hợp cơ chế đó bị viết sai ở WO sau — trùng số sẽ 23505 FAIL-LOUD thay vì
-- hai tin cùng số im lặng (con trỏ phân trang trùng số = mất/lặp tin khi cuộn).
CREATE UNIQUE INDEX uq_chat_messages_room_seq ON chat_messages (company_id, room_id, room_seq);
--> statement-breakpoint

-- Con trỏ phân trang đổi sang room_seq ⇒ index đọc phải đổi theo. Index cũ (0538) neo `seq` toàn cục.
DROP INDEX IF EXISTS idx_chat_messages_room_seq;
--> statement-breakpoint
CREATE INDEX idx_chat_messages_room_seq ON chat_messages (company_id, room_id, room_seq DESC);
--> statement-breakpoint

-- Backfill lại 3 cột "con trỏ" của 0538 sang hệ room_seq. Trên PROD cả ba đang 0/NULL (0 phòng, 0 tin)
-- nên đây là no-op; giữ để môi trường có dữ liệu không mang số của hệ cũ.
--   • chat_rooms.last_message_seq  = room_seq lớn nhất của phòng (mẫu số của phép trừ)
--   • chat_room_members.last_read_seq = 0 (chưa đọc gì theo hệ mới — thà báo thừa còn hơn giấu tin)
--   • chat_room_members.visible_from_seq: v1 LUÔN NULL (CHAT-DEC-008) ⇒ không đụng
UPDATE chat_rooms r
   SET last_message_seq = sub.mx
  FROM (SELECT company_id, room_id, max(room_seq) AS mx FROM chat_messages GROUP BY 1, 2) sub
 WHERE r.id = sub.room_id AND r.company_id = sub.company_id;
--> statement-breakpoint

UPDATE chat_room_members SET last_read_seq = 0 WHERE last_read_seq <> 0;
--> statement-breakpoint

-- ─────────── VERIFY FAIL-LOUD ───────────
DO $$
DECLARE v_bad int;
BEGIN
  -- (1) room_seq phải LIÊN TỤC TỪ 1 trong mỗi phòng (không lỗ, không bắt đầu từ 0)
  SELECT count(*) INTO v_bad FROM (
    SELECT room_id
      FROM chat_messages
     GROUP BY company_id, room_id
    HAVING min(room_seq) <> 1 OR max(room_seq) <> count(*)
  ) q;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0539] % phong co room_seq khong lien tuc tu 1 — backfill truot', v_bad;
  END IF;

  -- (2) last_message_seq của phòng phải khớp room_seq lớn nhất (mẫu số phép trừ)
  SELECT count(*) INTO v_bad
    FROM chat_rooms r
    LEFT JOIN (SELECT company_id, room_id, max(room_seq) mx FROM chat_messages GROUP BY 1,2) s
           ON s.room_id = r.id AND s.company_id = r.company_id
   WHERE coalesce(r.last_message_seq, 0) <> coalesce(s.mx, 0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0539] % phong co last_message_seq lech room_seq lon nhat', v_bad;
  END IF;

  -- (3) KHÔNG cấp thêm quyền ghi nào trên chat_messages (bất biến #2 — room_seq gán lúc INSERT)
  SELECT count(*) INTO v_bad
    FROM information_schema.table_privileges
   WHERE grantee = 'mediaos_app' AND table_name = 'chat_messages'
     AND privilege_type IN ('UPDATE', 'DELETE');
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0539] chat_messages co % quyen UPDATE/DELETE cap bang — vo bat bien #2', v_bad;
  END IF;

  RAISE NOTICE '[0539] VERIFY OK: room_seq lien tuc · last_message_seq khop · append-only nguyen ven';
END;
$$;
--> statement-breakpoint

-- ─────────── ĐƯỜNG LÙI (không chạy — comment) ───────────
-- DROP INDEX uq_chat_messages_room_seq, idx_chat_messages_room_seq;
-- CREATE INDEX idx_chat_messages_room_seq ON chat_messages (company_id, room_id, seq DESC);
-- ALTER TABLE chat_messages DROP COLUMN room_seq;
-- ⚠️ KHÔNG hoàn nguyên được `last_read_seq` về hệ seq toàn cục (đã bị đặt 0). Không mất dữ liệu nghiệp
--    vụ — chỉ là mọi người thấy lại toàn bộ tin là "chưa đọc". Chấp nhận được vì hệ cũ vốn ĐANG SAI.
