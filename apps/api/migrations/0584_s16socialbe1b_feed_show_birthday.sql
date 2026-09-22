-- Migration 0584: S16-SOCIAL-BE-1B (🔴 RED, zone=red, crown) — cột `user_preferences.show_birthday`.
--   THUẦN ADD COLUMN additive. KHÔNG db:generate, KHÔNG RLS/policy/GRANT mới.
--
-- VÌ SAO CẦN: SPEC-16 §3.5 + SOC-DEC-007 chốt nhân viên tự ẩn sinh nhật bằng
--   `user_preferences.feed.showBirthday = false`. Đo thật ở S16-SOCIAL-BE-1 (plan §11.8): trường đó
--   **KHÔNG TỒN TẠI** ở DB — không cột `feed`, không `show_birthday`, không jsonb nào mang ngữ nghĩa
--   đó (`me_layout_config` là bố cục màn ME). Route `026 GET /social/birthdays` không đóng được nếu
--   thiếu cột này, và "tạm đọc me_layout_config" bị CẤM (nhét ngữ nghĩa SOCIAL vào ô của module khác
--   ⇒ một lượt dọn ME sau này xoá mất cờ riêng tư).
--
-- NULLABLE, KHÔNG DEFAULT (quyết định A3/D2, owner ký 22/09/2026):
--   NULL = kế thừa mặc định "hiện" (SOC-DEC-007 nguyên văn: «Nhân viên ẩn sinh nhật qua
--   `user_preferences.feed.showBirthday=false` (mặc định hiện)»). Đây là ÁP DỤNG luật cột override
--   sẵn có của CHÍNH bảng này (`schema/user-preferences.ts:37` «Cột override NULLABLE = kế thừa
--   company/system default»), không phải một quy ước mới. Đặt `DEFAULT true` sẽ biến "chưa cấu hình"
--   thành "đã chọn hiện" — hai việc khác nhau, và gộp chúng làm mất khả năng phân biệt về sau.
--
-- PHẠM VI CỦA CỜ (D10, owner ký 22/09/2026 — SPEC-16 dòng 254/502/548 đã sửa theo trong cùng WO):
--   cờ CHỈ chặn hai trường `day`/`month` (và mọi trường phái sinh từ `date_of_birth`). Nó KHÔNG ẩn
--   danh tính nhân viên (tên/avatar) khỏi tìm kiếm `023` / thẻ `024` / trang cá nhân `025` — đọc
--   nghĩa đen bản SPEC cũ ("mọi đường ra") thì bài của người ẩn sinh nhật biến mất khỏi tìm kiếm.
--
-- ⚠️ `ALTER TABLE ADD COLUMN` (không DEFAULT, không rewrite bảng) giữ ACCESS EXCLUSIVE lock NGẮN trên
--   `user_preferences` — bảng NÓNG của module ME (mọi request đọc preference đi qua nó). Chạy ngoài
--   giờ cao điểm nếu PROD.
--
-- BẤT BIẾN (CLAUDE.md §2): #1 company_id — bảng đã có RLS + FORCE + policy tenant_isolation từ 0495,
--   cột mới nằm trong CÙNG bảng đó nên thừa hưởng nguyên; KHÔNG policy mới (D4). #3 secret — cờ
--   boolean riêng tư, không phải secret, không vào log.

ALTER TABLE user_preferences
  ADD COLUMN show_birthday boolean;

COMMENT ON COLUMN user_preferences.show_birthday IS
  'S16-SOCIAL-BE-1B — NULL = kế thừa mặc định "hiện" (SOC-DEC-007). '
  'Chỉ gate 2 trường day/month ở /social/birthdays — KHÔNG ẩn danh tính ở search/tags/profiles (D10).';

DO $$
DECLARE
  v_is_nullable text;
  v_default     text;
BEGIN
  SELECT is_nullable, column_default
    INTO v_is_nullable, v_default
    FROM information_schema.columns
   WHERE table_name = 'user_preferences' AND column_name = 'show_birthday';

  -- Kiem CA HAI thuoc tinh, khong chi "cot ton tai": mot luot sua sau vo tinh them NOT NULL/DEFAULT
  -- se pha dung quyet dinh A3 (NULLABLE = ke thua) ma verify kieu "dem hang" se KHONG bat duoc —
  -- doc information_schema la kiem THUOC TINH SCHEMA, khong phai du lieu, nen khong dinh bay
  -- "verify dem hang xanh rong" da can o DB-2 (0 hang van qua neu dem dieu kien sai).
  IF v_is_nullable IS DISTINCT FROM 'YES' OR v_default IS NOT NULL THEN
    RAISE EXCEPTION '[0584] show_birthday phai NULLABLE khong DEFAULT (nullable=%, default=%) — fail-closed',
      v_is_nullable, v_default;
  END IF;
END $$;
