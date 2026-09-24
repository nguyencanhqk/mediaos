-- S16-SOCIAL-ATTDEBT-1 (C-5) — nới CHECK `security_alerts_type_check` cho loại `attach_gate_deny`.
--
-- Vì sao cần một loại MỚI thay vì mượn `repeated_cross_scope_deny` (owner ký S-3): chữ «repeated»
-- hàm ý NGƯỠNG, còn cổng gắn tệp phát tín hiệu theo TỪNG lượt deny. Mượn = ghi một lời khai SAI vào
-- một bảng **append-only** (sửa không được — đó là cả điểm của bảng), và làm nhiễu mọi câu đếm đang
-- dựa vào loại đó.
--
-- ⚠️ CHECK là **UNION, append chứ không rewrite** (CLAUDE.md §9.3 hot-file): liệt kê ĐỦ 3 giá trị cũ
--    (mig 0122) + 1 giá trị mới. Bỏ sót một giá trị cũ = làm vỡ mọi đường phát alert đang chạy.
-- ⚠️ `DROP CONSTRAINT IF EXISTS` (không phải `DROP CONSTRAINT` trần) — chống môi trường lệch, nơi
--    constraint đã bị đổi tên/gỡ tay.
-- ⚠️ `ADD CONSTRAINT ... CHECK` **revalidate toàn bảng và giữ khoá ACCESS EXCLUSIVE** trong lúc chạy.
--    Hôm nay `security_alerts` nhỏ nên không đáng kể — ghi ra đây để lần sau KHÔNG copy mù lên một
--    bảng lớn (lúc đó phải `ADD CONSTRAINT ... NOT VALID` rồi `VALIDATE CONSTRAINT` riêng).
-- ⚠️ HAI nơi phải đổi CÙNG lượt: DDL dưới đây **và** hằng TS `SECURITY_ALERT_TYPES`
--    (`src/db/schema/security-alerts.ts`). Quên hằng ⇒ TS đỏ (tốt). Quên DDL **hoặc quên dòng trong
--    `meta/_journal.json`** ⇒ migration bị BỎ QUA trong im lặng ⇒ INSERT vỡ CHECK lúc chạy ⇒ 500 ⇒
--    `SecurityAlertService.emit()` **NUỐT lỗi** ⇒ alert biến mất mà chỉ còn một dòng log. Lưới duy
--    nhất thấy được ca đó là int-spec H7 (assert HÀNG được ghi) + H11 (`pg_indexes`).
--
-- KHÔNG đụng RLS/FORCE/policy/grant của bảng (mig 0122 giữ nguyên: app role chỉ SELECT + INSERT).
-- Rollback: DROP + ADD lại CHECK với đúng 3 giá trị cũ (chỉ an toàn khi chưa có hàng `attach_gate_deny`).
ALTER TABLE security_alerts DROP CONSTRAINT IF EXISTS security_alerts_type_check;
--> statement-breakpoint
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_type_check CHECK (
  alert_type IN (
    'repeated_reauth_failure',
    'repeated_cross_scope_deny',
    'anomalous_login',
    'attach_gate_deny'
  )
);
