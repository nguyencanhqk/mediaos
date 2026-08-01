-- S6-LEAVE-ACCRUAL-1 — KHOÁ IDEMPOTENCY CỦA ENGINE CỘNG DỒN PHÉP (ép ở TẦNG DB)
--
-- VÌ SAO CẦN. Hợp đồng `JobHandler` (apps/api/src/scheduler/job-handler.ts:43) nói handler chạy MỖI
-- NHỊP scheduler (60 giây) và PHẢI idempotent ⇒ "cộng dồn định kỳ" và "bù kỳ bỏ lỡ" là CÙNG một đường
-- code, chạy đi chạy lại vô số lần trên cùng dữ liệu. Cấp trùng ở đây không phải lỗi hiển thị: mỗi
-- dòng thừa là một ngày phép có giá trị tiền được cấp cho người thật.
--
-- BA LỚP CHỐNG TRÙNG, ĐÂY LÀ LỚP CUỐI:
--   1. `JobRunner` chiếm `system_job_locks(job_code)` — đúng 1 instance chạy tại 1 thời điểm.
--   2. Engine đọc trước sổ cái ACCRUAL đã có rồi chỉ tính phần THIẾU.
--   3. ⬅ index này — chốt cho MỌI đường ghi, kể cả script tay, backfill, hay một instance lạc.
--      Lớp 1 và 2 đều nằm trong tay tầng app; lớp 3 thì không.
--
-- KHOÁ = (company_id, employee_id, leave_type_id, transaction_date). `transaction_date` mang KỲ, và
-- ánh xạ kỳ→ngày là ĐƠN ÁNH theo thiết kế (docs/plans/S6-LEAVE-ACCRUAL-1.md §3.4):
--   · Monthly kỳ (Y, m) → NGÀY CUỐI THÁNG (D-A1 "cấp vào ngày cuối tháng")
--   · Yearly/Prorated kỳ Y → 01/01 của năm
-- 01/01 KHÔNG BAO GIỜ là ngày-cuối-tháng ⇒ hai họ kỳ không thể đụng nhau, kể cả khi HR đổi chính sách
-- từ Monthly sang Yearly giữa năm. Vậy khoá này đúng bằng "(nhân viên, loại nghỉ, năm, tháng)" mà
-- Work Order yêu cầu.
--
-- HOT-FILE / BẤT BIẾN — THUẦN ADDITIVE:
--   • Chỉ THÊM 1 partial unique index. KHÔNG đổi dữ liệu, KHÔNG DROP/ALTER cột, ràng buộc, policy nào.
--   • KHÔNG đụng RLS/FORCE RLS của `leave_balance_transactions` (đã bật từ mig 0453) và KHÔNG đụng
--     grant append-only (BẤT BIẾN #2: `mediaos_app` = SELECT+INSERT, `mediaos_worker` = SELECT).
--     Index không cấp thêm quyền cho ai.
--   • PARTIAL theo `transaction_type = 'ACCRUAL'` ⇒ KHÔNG chạm RESERVE/RELEASE/USE/REFUND/ADJUSTMENT/
--     EXPIRE/CARRY_OVER. Đặc biệt: S6-LEAVE-CARRYOVER-1 (WO nối tiếp, ghi CARRY_OVER/EXPIRE trên đúng
--     bảng này) KHÔNG bị index này ràng buộc.
--   • `CREATE UNIQUE INDEX IF NOT EXISTS` (KHÔNG CONCURRENTLY): drizzle chạy migration trong một
--     transaction, mà CONCURRENTLY không chạy được trong transaction. Khoá ghi ngắn là chấp nhận được —
--     đo trên PROD 2026-08-01: `leave_balance_transactions` có **0 dòng**, nên vừa không thể vỡ vì dữ
--     liệu trùng có sẵn, vừa dựng xong tức thì.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_leave_balance_tx_accrual_period"
  ON "leave_balance_transactions" ("company_id", "employee_id", "leave_type_id", "transaction_date")
  WHERE "transaction_type" = 'ACCRUAL';

COMMENT ON INDEX "uq_leave_balance_tx_accrual_period" IS
  'S6-LEAVE-ACCRUAL-1: mỗi (nhân viên, loại nghỉ, kỳ) chỉ được cấp ĐÚNG MỘT LẦN. Kỳ mã hoá trong transaction_date: Monthly = ngày cuối tháng, Yearly/Prorated = 01/01. Partial theo ACCRUAL nên không ràng buộc CARRY_OVER/EXPIRE/ADJUSTMENT.';
