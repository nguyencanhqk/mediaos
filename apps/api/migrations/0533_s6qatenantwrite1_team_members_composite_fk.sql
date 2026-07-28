-- S6-QA-TENANTWRITE-1 · KI-037 — BỊT LIÊN KẾT CHÉO TENANT Ở `team_members` (composite FK)
--
-- LỖ HỔNG (BẤT BIẾN #1). Kiểm tra khoá ngoại của Postgres **BỎ QUA RLS theo thiết kế** (FK check chạy
-- với quyền hệ thống, không áp policy). Vì `team_members` chỉ có FK MỘT CỘT `team_id → teams(id)`,
-- app role đứng trong ngữ cảnh tenant A chèn được hàng `company_id = A` nhưng `team_id` của tenant B:
-- FK thấy team đó TỒN TẠI nên cho qua, còn RLS `WITH CHECK` chỉ soi `company_id` (= A, hợp lệ).
--
-- ĐÃ TÁI LẬP (lane DB, role `mediaos_app`, S6-SEC-ORGSCOPE-1 FULL gate 2026-07-28 + RED test của WO này):
--   ctx = A → INSERT INTO team_members (company_id=A, team_id=<team của B>, user_id=<user của A>)
--   ⇒ `INSERT 0 1` — THÀNH CÔNG.
--
-- HẬU QUẢ: đường ĐỌC hôm nay an toàn nhờ `innerJoin(teams)` trong `org.repository.ts` (đo tại FULL
-- gate), nên đây KHÔNG phải rò dữ liệu trực tiếp. Nhưng liên kết chéo tenant TỒN TẠI THẬT trong dữ
-- liệu, và `ON DELETE CASCADE` của `teams` bắc cầu sang tenant khác: xoá một team ở B sẽ xoá hàng
-- `team_members` mang `company_id = A`. Đó là ghi chéo tenant do hệ thống tự thực hiện.
--
-- PHẠM VI CÓ HẠN — NÓI RÕ ĐỂ KHÔNG AI ĐỌC QUÁ: migration này vá ĐÚNG MỘT cặp bảng, cặp duy nhất đã
-- được chứng minh khai thác được đầu-cuối. Đo trên chính DB này: **460 khoá ngoại một-cột** nối hai
-- bảng đều có `company_id`, và **chỉ 1** là composite. Toàn bộ phần còn lại là cùng một lớp lỗ hổng,
-- đã ghi thành known-issue + WO riêng (RELEASE-02 KI-045). KHÔNG gộp vào đây: 459 cặp còn lại cần
-- unique constraint mới trên từng bảng đích + rà `ON DELETE` từng cái, là thay đổi schema diện rộng
-- phải có gate riêng.
--
-- HOT-FILE / BẤT BIẾN:
--   • THUẦN ADDITIVE: chỉ THÊM 1 unique constraint + 1 FK. KHÔNG đụng policy/RLS/grant nào.
--   • FK cũ `team_members_team_id_fkey` GIỮ NGUYÊN (không DROP): nó vẫn đúng, chỉ là chưa đủ.
--     Bỏ nó = expand-contract không cần thiết cho một ràng buộc đang hoạt động đúng.
--   • `ON DELETE CASCADE` giữ đồng bộ với FK cũ để hành vi xoá team KHÔNG đổi trong-tenant.
--   • Idempotent: cả hai bước đều `IF NOT EXISTS` / kiểm `pg_constraint` trước.
--
-- BAND 0533 (nối tiếp head 0532 tại thời điểm làm). Journal: idx 200, when 1717587322000.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- (0) DỌN TRƯỚC: hàng lệch đã tồn tại sẽ làm bước (2) thất bại. Ở PROD phép đo cho 0 hàng, nhưng
--     migration phải tự đứng vững trên mọi DB (lane test đã từng chèn hàng lệch bằng chính RED test).
--     Xoá là ĐÚNG: hàng `team_members` trỏ sang team của tenant khác không có nghĩa nghiệp vụ nào.
DELETE FROM team_members tm
 USING teams t
 WHERE tm.team_id = t.id
   AND tm.company_id IS DISTINCT FROM t.company_id;

-- (1) Đích của composite FK phải có UNIQUE tương ứng. `teams.id` đã là PK nên (company_id, id) là
--     unique một cách tầm thường — constraint này chỉ để Postgres CHẤP NHẬN nó làm đích tham chiếu.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'teams'::regclass AND conname = 'teams_company_id_id_uq'
  ) THEN
    ALTER TABLE teams ADD CONSTRAINT teams_company_id_id_uq UNIQUE (company_id, id);
  END IF;
END $$;

-- (2) Composite FK: từ nay `team_id` PHẢI thuộc CÙNG company_id với hàng team_members.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'team_members'::regclass AND conname = 'team_members_company_team_fk'
  ) THEN
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_company_team_fk
      FOREIGN KEY (company_id, team_id) REFERENCES teams (company_id, id) ON DELETE CASCADE;
  END IF;
END $$;
