-- S7-CHAT-CLEAN-2 — gỡ HAI index TIỀN TỐ TRÙNG trên `chat_messages` (di sản mig `0010`, kỷ nguyên media).
--
-- ⚠️ ĐỌC PHẦN NÀY TRƯỚC KHI "DỌN TIẾP": "idx_scan = 0 ⇒ drop được" là SAI, và số đo dưới đây chứng minh.
--
-- ═══════════ SỐ ĐO (lane `mediaos_chatclean2`, chain 0000→0540 sạch, 2026-08-04) ═══════════
-- Quy trình: `pg_stat_reset()` → chạy TOÀN BỘ 9 file chat int-spec (207 test XANH) → đọc
-- `pg_stat_user_indexes`. Bảng `chat_messages` còn 19 dòng sống, 114 seq_scan, 1284 idx_scan.
--
-- ⚠️⚠️ BẢNG DƯỚI LÀ **ẢNH CHỤP MỘT LƯỢT CHẠY**, KHÔNG PHẢI HẰNG SỐ — và chính nó đã tự phản chứng.
-- Đo lại CÙNG LANE sau khi thêm `chat-noti-e2e` + `chat-be-gate2` vào bộ chạy: `idx_chat_messages_reply`
-- **0 → 626** và `uq_chat_messages_client_id` **0 → 130**. Hai cái đó nằm trong nhóm "idx_scan = 0" của
-- ảnh chụp đầu. Nếu đọc `done_when` theo nghĩa đen ("drop mọi cái zero") thì hai index ĐANG CHẠY THẬT đã
-- bị gỡ — bằng chứng trực tiếp rằng `idx_scan = 0` chỉ nói "bộ test lượt này không chạm", không nói
-- "không ai cần". Đừng dùng lại bảng này làm căn cứ drop cho lần sau; ĐO LẠI.
--
--   index                            idx_scan   phán quyết
--   ────────────────────────────────────────────────────────────────────────────────────────────────
--   idx_chat_messages_room_seq          1167     đường đọc chính (company_id, room_id, room_seq DESC)
--   chat_messages_room_seq_idx           102     đang là đường vào theo `room_id` — GIỮ
--   chat_messages_pinned_idx               9     GIỮ
--   chat_messages_pkey                     6     GIỮ
--   chat_messages_company_id_id_uq         0     ⛔ CẤM DROP — unique đỡ FK chat_messages_reply_to_tenant_fk
--   uq_chat_messages_client_id             0     ⛔ CẤM DROP — chống gửi trùng (CHAT-ERR-014) → sau đo lại: 130
--   uq_chat_messages_room_seq              0     ⛔ CẤM DROP — đai thứ hai của room_seq (0539)
--   idx_chat_messages_search (GIN)         0     ⛔ GIỮ — 19 dòng thì planner luôn seq-scan
--   idx_chat_messages_reply                0     GIỮ — cùng lý do bảng nhỏ        → sau đo lại: 626
--   chat_messages_company_id_idx           0     ✅ DROP — xem (A)
--   chat_messages_room_id_idx              0     ✅ DROP — xem (B)
--
-- ⚠️ BẪY 1 — `idx_scan` KHÔNG đếm phép kiểm UNIQUE lúc INSERT. Ba unique ở trên đều hiện `0` trong khi
--    chính int-spec chứng minh chúng đang có răng (`uq_chat_messages_room_seq` bắn `23505` ở ca "trùng
--    số → 23505"). Chúng là RÀNG BUỘC ĐÚNG ĐẮN, không phải index tăng tốc: drop = mở lỗ dữ liệu.
-- ⚠️ BẪY 2 — bảng nhỏ ⇒ seq-scan rẻ hơn ⇒ index HOÀN TOÀN ĐÚNG vẫn ra `0`. GIN `search_vector` là ví dụ:
--    22 ca int-spec của BE-4 chạy qua nó mà vẫn `0`.
-- ⇒ Chỉ drop khi CÓ CẢ HAI: (i) `idx_scan = 0` VÀ (ii) tồn tại index KHÁC có cột dẫn đầu bao trùm nó.
--    Hai index dưới đây là các trường hợp DUY NHẤT thoả cả hai.
--
-- ═══════════ (A) chat_messages_company_id_idx — (company_id) ═══════════
-- TIỀN TỐ CHẶT của `chat_messages_company_id_id_uq (company_id, id)` và của
-- `idx_chat_messages_room_seq (company_id, room_id, room_seq DESC)` (1167 lượt quét). Mọi truy vấn dùng
-- được nó đều dùng được hai index kia.
--
-- ═══════════ (B) chat_messages_room_id_idx — (room_id) ═══════════
-- TIỀN TỐ CHẶT của `chat_messages_room_seq_idx (room_id, seq)` — và index bao trùm đó đang chạy THẬT
-- (102 lượt), tức đường vào theo `room_id` vẫn còn nguyên sau khi drop.
--
-- ═══════════ ĐƯỜNG RI (khoá ngoại) SAU KHI DROP — ĐỦ 9 FK, đo từng cái ═══════════
-- DROP index trên bảng CON làm chậm phép kiểm RI khi xoá hàng CHA, nên phải soi TOÀN BỘ FK trỏ ra
-- ngoài. `chat_messages` có **9** (đo: `pg_constraint` contype='f' trên conrelid='chat_messages').
--
--   FK (cột)                                          index phủ SAU 0541              phán quyết
--   ──────────────────────────────────────────────────────────────────────────────────────────────
--   company_id_fkey        (company_id)               company_id_id_uq (tiền tố)      OK
--   room_id_fkey           (room_id)                  chat_messages_room_seq_idx      OK
--   room_id_company_fk     (company_id, room_id)      idx_chat_messages_room_seq      OK
--   reply_to_tenant_fk     (company_id, reply_to_…)   idx_chat_messages_reply         OK (vị từ khớp)
--   sender_id_company_fk   (company_id, sender_id)    company_id_id_uq — chỉ tiền tố  KHÔNG ĐỔI (*)
--   pinned_by_company_fk   (company_id, pinned_by)    company_id_id_uq — chỉ tiền tố  KHÔNG ĐỔI (*)
--   recalled_by_tenant_fk  (company_id, recalled_by)  company_id_id_uq — chỉ tiền tố  KHÔNG ĐỔI (*)
--   sender_id_fkey         (sender_id)                KHÔNG CÓ → seq-scan             KHÔNG ĐỔI (**)
--   pinned_by_fkey         (pinned_by)                KHÔNG CÓ → seq-scan             KHÔNG ĐỔI (**)
--
-- ⇒ Khẳng định ĐÚNG là: **không FK nào TỆ ĐI vì cú drop này** — KHÔNG phải "không FK nào seq-scan".
--   (*)  Ba FK `(company_id, X)` này trước 0541 cũng chỉ có index dẫn đầu `company_id` để dựa vào
--        (chính `chat_messages_company_id_idx` vừa gỡ). Sau 0541 chúng dựa vào
--        `chat_messages_company_id_id_uq (company_id, id)` — CÙNG cột dẫn đầu, cùng độ chọn lọc trên
--        `company_id`. Không mất gì.
--   (**) HAI FK MỘT CỘT tới `users` KHÔNG có index dẫn đầu — **đã seq-scan TỪ TRƯỚC 0541**, không
--        phải hệ quả của WO này (cả hai index bị gỡ đều không nằm trên `sender_id`/`pinned_by`).
--        Ghi ra ở đây để lần dọn sau không đọc nhầm bảng này thành "mọi FK đều được phủ". Tác động
--        thực tế thấp: `users` không xoá cứng được ở tầng app (0467 REVOKE DELETE) và
--        `sender_id_fkey` là ON DELETE RESTRICT (0540) — RI chỉ chạy ở đường xoá cấp OWNER.
--
-- KHÔNG PHẢI LỆNH PHÁ HUỶ THEO §15.5: không drop cột/bảng, 0 dòng dữ liệu bị đụng
-- (`scripts/check-migration-no-drop.sh` cố ý không quét `DROP INDEX` — xem khối chú thích của nó).
-- Đi kèm: gỡ 2 dòng khai tương ứng ở `apps/api/src/db/schema/communication.ts`, nếu không `db:generate`
-- sẽ dựng lại chúng ở migration sau.
--
-- ĐƯỜNG LUI (dán nguyên văn, không cần suy lại):
--   CREATE INDEX chat_messages_room_id_idx    ON chat_messages (room_id);
--   CREATE INDEX chat_messages_company_id_idx ON chat_messages (company_id);
--
-- ⚠️ KHOÁ: `DROP INDEX` (và `CREATE INDEX` không CONCURRENTLY) lấy **ACCESS EXCLUSIVE** trên bảng —
-- tiền lệ `0221:19-21`. Chạy được ở đây vì CHAT chưa live (`is_active = false`, 0 dòng PROD) nên bảng
-- rỗng và khoá tính bằng mili-giây. NẾU chạy lại trên một cụm đã có tải, dùng bản out-of-band
-- (NGOÀI transaction migration, `CONCURRENTLY` không chạy được bên trong):
--   DROP INDEX CONCURRENTLY chat_messages_company_id_idx;
--   CREATE INDEX CONCURRENTLY chat_messages_room_id_idx ON chat_messages (room_id);   -- đường lui

DROP INDEX IF EXISTS chat_messages_company_id_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS chat_messages_room_id_idx;
--> statement-breakpoint

-- ═══════════ VERIFY — chạy trong CÙNG transaction migration, đỏ thì hoàn nguyên sạch ═══════════
DO $$
DECLARE v_con text; v_thieu text;
BEGIN
  -- (1) hai index dư đã biến mất
  SELECT string_agg(indexrelname, ', ') INTO v_con
    FROM pg_stat_user_indexes
   WHERE relname = 'chat_messages'
     AND indexrelname IN ('chat_messages_company_id_idx', 'chat_messages_room_id_idx');
  IF v_con IS NOT NULL THEN
    RAISE EXCEPTION '[0541] index du VAN CON: %', v_con;
  END IF;

  -- (2) MỌI index phải-giữ còn nguyên. Đây mới là vế quan trọng: một tay sửa sau "dọn tiếp" theo
  --     idx_scan = 0 sẽ đụng đúng danh sách này và migration của họ sẽ ĐỎ tại đây thay vì lặng lẽ
  --     gỡ mất một ràng buộc đúng đắn (unique) hay đường đọc duy nhất còn lại.
  SELECT string_agg(x.ten, ', ') INTO v_thieu
    FROM unnest(ARRAY[
           'chat_messages_pkey',
           'chat_messages_company_id_id_uq',   -- đỡ composite tenant FK (KI-046)
           'uq_chat_messages_client_id',       -- chống gửi trùng
           'uq_chat_messages_room_seq',        -- đai thứ hai của room_seq
           'idx_chat_messages_room_seq',       -- đường đọc chính + tiền tố RI (company_id, room_id)
           'chat_messages_room_seq_idx',       -- đường vào room_id còn lại sau (B)
           'idx_chat_messages_search',
           'idx_chat_messages_reply',
           'chat_messages_pinned_idx'
         ]) AS x(ten)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_stat_user_indexes i
            WHERE i.relname = 'chat_messages' AND i.indexrelname = x.ten);
  IF v_thieu IS NOT NULL THEN
    RAISE EXCEPTION '[0541] THIEU index phai-giu tren chat_messages: %', v_thieu;
  END IF;

  RAISE NOTICE '[0541] OK — go 2 index tien to trung, 9 index phai-giu con nguyen';
END;
$$;
