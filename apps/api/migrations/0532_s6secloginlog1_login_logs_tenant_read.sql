-- S6-SEC-LOGINLOG-1 · KI-042 — SIẾT VẾ ĐỌC CỦA `login_logs` (hàng NULL-tenant đọc được chéo tenant)
--
-- LỖ HỔNG (BẤT BIẾN #1 — cô lập dữ liệu theo company_id). Policy `tenant_isolation` ở mig 0443:115-126
-- có `OR company_id IS NULL` trong vế **USING**, nên MỌI tenant đọc được toàn bộ hàng `company_id IS NULL`.
-- Các hàng đó là lần thử đăng nhập PRE-AUTH và mang `email` + `normalized_email` + `ip_address` +
-- `user_agent` của người dùng KHÔNG thuộc tenant đang đọc.
--
-- ĐÃ TÁI LẬP trên DB lane dựng mới (0000→0531), role `mediaos_app`:
--   • trong ngữ cảnh tenant A → SELECT trả về hàng NULL-tenant `victim@other-tenant.test` / `203.0.113.9`;
--   • NGOÀI mọi ngữ cảnh tenant (không set GUC) → VẪN trả về hàng NULL-tenant đó.
-- Vế thứ hai nặng hơn mô tả ban đầu của KI-042: không cần đứng trong tenant nào cũng đọc được.
--
-- ĐO TRÊN PROD (read-only, 2026-07-28): 314 hàng `login_logs` = 46 attributed + **268 NULL-tenant**
-- (165 `blocked/TooManyAttempts` + 103 `failed/CompanyInactive`), phơi 5 email riêng biệt + 5 IP.
-- Vì PROD đang N=1 company nên chưa có tenant thứ hai để đọc trộm ⇒ ảnh hưởng sống hiện tại = 0;
-- sửa BÂY GIỜ, trước khi mở tenant thứ hai, là lý do WO này không được defer (RELEASE-02 §3).
--
-- ─────────────────────────── MÔ HÌNH ĐỌC ĐƯỢC CHỐT (done_when #1) ───────────────────────────
-- Hàng `company_id IS NULL` = **telemetry pre-auth VÔ CHỦ**, KHÔNG thuộc về tenant nào. Sau migration
-- này KHÔNG tenant nào đọc được chúng qua đường ứng dụng; chúng chỉ còn đọc được bằng `mediaos`
-- (superuser + BYPASSRLS, chủ bảng) qua truy cập DB trực tiếp — tức là của NGƯỜI VẬN HÀNH NỀN TẢNG,
-- phục vụ forensics brute-force. KHÔNG dựng role/route operator mới ở WO này (YAGNI: chưa có người
-- đọc nào); khi nào cần thì thêm policy permissive riêng cho đúng role đó, KHÔNG nới lại `tenant_isolation`.
-- Đã kiểm `pg_roles`: chỉ `mediaos` có rolsuper/rolbypassrls; `mediaos_app`/`mediaos_worker`/
-- `mediaos_owner`/`mediaos_readonly` đều KHÔNG — và `login_logs` bật FORCE RLS nên kể cả chủ bảng
-- cũng bị policy chi phối.
--
-- ─────────────────────────── VÌ SAO CHỈ SỬA USING, GIỮ NGUYÊN WITH CHECK ───────────────────────────
-- Vế WITH CHECK của 0443 ĐÃ ĐÚNG và là thứ giữ cho đường ghi pre-auth sống: cho ghi `company_id = GUC`,
-- HOẶC ghi NULL **chỉ khi không có ngữ cảnh tenant**. Postgres không áp USING cho INSERT ⇒ siết USING
-- KHÔNG làm mù đường ghi. Đã chứng minh trên DB lane: sau khi siết, `INSERT ... VALUES (NULL, ...)`
-- ngoài ngữ cảnh vẫn `INSERT 0 1`.
--
-- ⚠️ BẪY ĐÃ ĐO, PHẢI BIẾT KHI SỬA `recordLoginAttempt`: Postgres áp **policy SELECT lên mệnh đề
-- RETURNING** của INSERT. Vì vậy sau migration này `INSERT ... (NULL, ...) RETURNING id` sẽ ném
-- "new row violates row-level security policy", trong khi INSERT KHÔNG RETURNING thì chạy bình thường.
-- Đường ghi thật (`auth.service.ts` → `db.insert(loginLogs).values({...})`) KHÔNG dùng RETURNING nên
-- không ảnh hưởng. Nhưng thêm `.returning()` vào đó sau này sẽ **giết log pre-auth trong im lặng**
-- (lỗi bị nuốt vào nhánh best-effort `logger.error`). Đã ghim bằng test + chú thích tại điểm ghi.
--
-- ─────────────────────────── GIỮ NGUYÊN ───────────────────────────
--   • GRANT SELECT, INSERT ON login_logs TO mediaos_app  (append-only, BẤT BIẾN #2 — 0443:133)
--   • GRANT SELECT ON login_logs TO mediaos_worker
--   • ENABLE + FORCE ROW LEVEL SECURITY
-- Migration này KHÔNG chạm grant và KHÔNG xoá dữ liệu (268 hàng NULL-tenant vẫn còn nguyên cho
-- forensics — chỉ đường đọc bị siết).
--
-- ĐỐI CHIẾU HÀNG XÓM: `public_holidays` (0434) dùng cùng khuôn `USING (… OR company_id IS NULL)` và
-- 0443 chép theo. Với `public_holidays` khuôn đó ĐÚNG — hàng NULL là ngày lễ toàn quốc, dữ liệu tham
-- chiếu dùng CHUNG có chủ đích. Với `login_logs` thì SAI — hàng NULL là dấu vết bảo mật của người lạ,
-- không phải dữ liệu dùng chung. Đây là lỗi chép khuôn, không phải quyết định thiết kế.

DROP POLICY IF EXISTS tenant_isolation ON login_logs;

CREATE POLICY tenant_isolation ON login_logs
  -- ĐỌC: CHỈ hàng của tenant hiện tại. Không còn `OR company_id IS NULL`. Ngoài ngữ cảnh tenant thì
  -- current_setting → '' → NULLIF → NULL ⇒ `company_id = NULL` là NULL (không TRUE) ⇒ 0 hàng.
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  )
  -- GHI: giữ NGUYÊN VĂN vế WITH CHECK của 0443 — ghi hàng của tenant mình, hoặc ghi hàng vô chủ
  -- (NULL) CHỈ khi KHÔNG có ngữ cảnh tenant (pre-auth). Chặn ghi NULL khi đang đứng trong tenant.
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR (
      company_id IS NULL
      AND NULLIF(current_setting('app.current_company_id', true), '') IS NULL
    )
  );

COMMENT ON POLICY tenant_isolation ON login_logs IS
  'S6-SEC-LOGINLOG-1 (KI-042): USING chỉ tenant hiện tại — hàng company_id IS NULL (pre-auth vô chủ, '
  'mang email+IP người lạ) KHÔNG đọc được qua đường ứng dụng, chỉ superuser đọc trực tiếp cho forensics. '
  'WITH CHECK giữ nguyên 0443 để đường ghi pre-auth không bị làm mù. Lưu ý: INSERT ... RETURNING sẽ bị '
  'chặn cho hàng NULL vì Postgres áp policy SELECT lên RETURNING.';
